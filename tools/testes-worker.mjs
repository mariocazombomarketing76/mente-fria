#!/usr/bin/env node
/* =============================================================================
   MENTE FRIA — testes do Worker de dados (offline, sem rede)

   Correr com:  node tools/testes-worker.mjs

   Não toca nas APIs reais: substitui fetch e a Cache API por dublês. Testa a
   allowlist (o Worker não pode ser proxy aberto), os TTL, o hit/miss de cache,
   o stale-if-error, o limite de frequência e a origem cruzada.
   ========================================================================== */

import worker from "../worker/index.mjs";
import {
  validarAlvo, validarAlvoCsv, pareceCsv, ttlPara, chaveCache, limiteExcedido,
  TTL_CSV, VERSAO_API, anfitriaoFinalPermitido
} from "../worker/nucleo.mjs";

let total = 0;
let falhas = 0;
const ok = (cond, nome, extra) => {
  total++;
  if (cond) console.log("  ✓ " + nome);
  else { falhas++; console.log("  ✗ " + nome + (extra ? "  → " + extra : "")); }
};
const grupo = (t) => console.log("\n■ " + t);

/* ------------------------------------------------------------------ */
/* Dublês                                                              */
/* ------------------------------------------------------------------ */
class CacheFake {
  constructor() { this.mapa = new Map(); this.puts = 0; }
  async match(pedido) {
    const chave = typeof pedido === "string" ? pedido : pedido.url;
    const guardada = this.mapa.get(chave);
    return guardada ? guardada.clone() : undefined;
  }
  async put(pedido, resposta) {
    this.puts++;
    this.mapa.set(typeof pedido === "string" ? pedido : pedido.url, resposta.clone());
  }
  async envelhecer(horas) {
    for (const [chave, resposta] of this.mapa) {
      const cabecalhos = new Headers(resposta.headers);
      cabecalhos.set("x-mf-guardado", new Date(Date.now() - horas * 3600 * 1000).toISOString());
      this.mapa.set(chave, new Response(await resposta.text(), { headers: cabecalhos }));
    }
  }
}

const cacheFake = new CacheFake();
globalThis.caches = { default: cacheFake };

let chamadasFonte = 0;
let respostaFonte = () => new Response(JSON.stringify({ events: [{ idEvent: "1" }] }), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});
/* As respostas criadas à mão não têm `url` (no runtime real têm). O Worker
   confirma o anfitrião FINAL do pedido, por isso o dublê preenche-o com o URL
   pedido — ou com outro, quando o teste simula um redireccionamento. */
globalThis.fetch = async (url) => {
  chamadasFonte++;
  const resposta = await respostaFonte(String(url));
  if (!resposta.url) Object.defineProperty(resposta, "url", { value: String(url) });
  return resposta;
};

/** Resposta que diz ter vindo de outro endereço (redireccionamento). */
const respostaDe = (endereco, corpo, init) => {
  const resposta = new Response(corpo, init || { status: 200 });
  Object.defineProperty(resposta, "url", { value: endereco });
  return resposta;
};

const esperas = [];
const contexto = { waitUntil: (p) => { esperas.push(p); } };
const ambiente = { ASSETS: { fetch: async () => new Response("estático", { status: 200 }) } };

const chamar = async (caminho, init) => {
  const pedido = new Request("https://mente-fria.goloaovivo.workers.dev" + caminho, init);
  const resposta = await worker.fetch(pedido, ambiente, contexto);
  await Promise.all(esperas.splice(0));
  return resposta;
};

const alvo = (url) => "/api/fonte?u=" + encodeURIComponent(url);
const ESPN_OK = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261017";
const TDB_OK = "https://www.thesportsdb.com/api/v1/json/123/eventsround.php?id=5229&r=5&s=2025-2026";

/* ------------------------------------------------------------------ */
console.log("MENTE FRIA — Worker /api (offline)");

grupo("Allowlist de alvos (não é proxy aberto)");
ok(validarAlvo(ESPN_OK) !== null, "ESPN scoreboard aceite");
ok(validarAlvo(TDB_OK) !== null, "TheSportsDB eventsround aceite");
ok(validarAlvo("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/359/schedule") !== null,
  "ESPN histórico de equipa aceite");
ok(validarAlvo("https://exemplo.com/qualquer") === null, "anfitrião desconhecido rejeitado");
ok(validarAlvo("http://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard") === null,
  "http (sem TLS) rejeitado");
ok(validarAlvo("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/roster") === null,
  "caminho fora da lista rejeitado");
ok(validarAlvo(ESPN_OK + "&foo=bar") === null, "parâmetro desconhecido rejeitado");
ok(validarAlvo(ESPN_OK + "&dates=20260101") === null, "parâmetro repetido rejeitado");
ok(validarAlvo("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=abc") === null,
  "valor de parâmetro inválido rejeitado");
ok(validarAlvo("https://user:pass@site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard") === null,
  "credenciais na URL rejeitadas");
ok(validarAlvo("javascript:alert(1)") === null, "esquema javascript: rejeitado");
ok(validarAlvo(null) === null, "alvo ausente rejeitado");

grupo("TTL por tipo de dado");
const agora = Date.parse("2026-10-17T10:00:00Z");
ok(ttlPara(new URL(ESPN_OK), agora) === 900, "scoreboard de hoje: 15 min");
ok(ttlPara(new URL("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261010"), agora) === 86400,
  "scoreboard de dia passado: 24 h");
ok(ttlPara(new URL("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261101"), agora) === 21600,
  "scoreboard futuro: 6 h");
ok(ttlPara(new URL("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/359/schedule"), agora) === 43200,
  "histórico de equipa: 12 h");
ok(ttlPara(new URL("https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-10-17&s=Soccer&l=5229"), agora) === 900,
  "eventsday de hoje: 15 min");
ok(ttlPara(new URL("https://www.thesportsdb.com/api/v1/json/123/eventsseason.php?id=5229&s=2025-2026"), agora) === 604800,
  "eventsseason: 7 dias");

grupo("Rotas e protecções");
const estado = await chamar("/api/estado");
const corpoEstado = await estado.json();
ok(estado.status === 200 && corpoEstado.versao === VERSAO_API, "/api/estado responde com a versão");
ok((await chamar("/api/qualquer")).status === 404, "rota /api desconhecida → 404");
ok((await chamar(alvo(ESPN_OK), { method: "POST" })).status === 405, "POST → 405");
ok((await chamar(alvo(ESPN_OK), { headers: { Origin: "https://site-malicioso.example" } })).status === 403,
  "origem cruzada → 403");
ok((await chamar(alvo("https://exemplo.com/x"))).status === 403,
  "alvo fora da lista → 403 (pedido bem formado, alvo recusado)");
ok((await chamar("/api/fonte")).status === 400, "sem o parâmetro u → 400");
ok((await chamar(alvo(ESPN_OK) + "&extra=1")).status === 400,
  "parâmetro inesperado no nosso endpoint → 400");
const corpoExtra = await (await chamar(alvo(ESPN_OK) + "&extra=1")).json();
ok(/parâmetro não reconhecido/.test(corpoExtra.erro || ""), "o 400 diz qual é o parâmetro estranho");

grupo("Cache: miss, hit e stale-if-error");
respostaFonte = () => new Response(JSON.stringify({ events: [{ idEvent: "7" }] }), { status: 200 });
const antes = chamadasFonte;
const miss = await chamar(alvo(ESPN_OK));
const corpoMiss = await miss.json();
ok(miss.status === 200 && miss.headers.get("x-mf-estado") === "miss", "1.º pedido → miss");
ok(chamadasFonte === antes + 1, "1.º pedido vai à fonte (1 chamada)");

const hit = await chamar(alvo(ESPN_OK));
const corpoHit = await hit.json();
ok(hit.headers.get("x-mf-estado") === "hit", "2.º pedido → hit de cache");
ok(chamadasFonte === antes + 1, "hit não gasta chamadas à fonte");
ok(JSON.stringify(corpoMiss) === JSON.stringify(corpoHit), "hit devolve o mesmo corpo");
ok(/max-age=\d+/.test(hit.headers.get("cache-control") || ""), "resposta traz Cache-Control com max-age");

await cacheFake.envelhecer(25);            // passa o TTL de 24 h (dia passado)
respostaFonte = () => new Response("erro", { status: 503 });
const stale = await chamar(alvo(ESPN_OK));
const corpoStale = await stale.json();
ok(stale.headers.get("x-mf-estado") === "stale", "fonte em baixo → serve cache antiga (stale)");
ok(corpoStale && Array.isArray(corpoStale.events), "stale devolve o corpo guardado, não um erro");
ok((stale.headers.get("x-mf-aviso") || "").indexOf("cache") !== -1, "stale identifica-se como dados de cache");

const semCache = await chamar(alvo("https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=20261010"));
ok(semCache.status === 502, "sem cache e fonte em baixo → 502 explícito");

grupo("Limite de frequência");
registosLimpos: {
  // Um IP por janela: o teste usa um IP próprio para não colidir com os anteriores.
  let excedeu = false;
  for (let i = 0; i < 61; i++) excedeu = limiteExcedido("203.0.113.9", agora);
  ok(excedeu, "61.º pedido do mesmo IP na mesma janela é travado");
  ok(limiteExcedido("203.0.113.10", agora) === false, "outro IP não é afectado");
}

grupo("CSV da folha de resultados (rota /api/csv)");
const CSV_OK = "https://docs.google.com/spreadsheets/d/1dd2IuvhK8tzg1qlTrryuOkkmsOsoYVVd3cBcC-l8sv4/export?format=csv&gid=0";
const csvAlvo = (url) => "/api/csv?u=" + encodeURIComponent(url);
ok(validarAlvoCsv(CSV_OK) !== null, "exportação CSV da folha aceite");
ok(validarAlvoCsv("https://docs.google.com/spreadsheets/d/1dd2IuvhK8tzg1qlTrryuOkkmsOsoYVVd3cBcC-l8sv4/export?format=xlsx") === null,
  "formato diferente de csv recusado");
ok(validarAlvoCsv("https://docs.google.com/spreadsheets/d/abc/export?format=csv") === null,
  "id de folha implausível recusado");
ok(validarAlvoCsv("https://docs.google.com/document/d/1dd2IuvhK8tzg1qlTrryuOkkmsOsoYVVd3cBcC-l8sv4/export?format=csv") === null,
  "outro tipo de documento do Google recusado");
ok(validarAlvoCsv("https://evil.example/spreadsheets/d/1dd2IuvhK8tzg1qlTrryuOkkmsOsoYVVd3cBcC-l8sv4/export?format=csv") === null,
  "anfitrião estranho recusado");
ok(validarAlvoCsv("https://docs.google.com/spreadsheets/d/1dd2IuvhK8tzg1qlTrryuOkkmsOsoYVVd3cBcC-l8sv4/export?format=csv&gid=0&gid=1") === null,
  "parâmetro gid repetido recusado (nunca é proxy aberto)");
ok(validarAlvo(CSV_OK) === null, "a rota de dados JSON não aceita o CSV do Google");
ok(pareceCsv("Data,Jogo,Linha\n2026-10-01,A vs B,2.5") , "CSV real aceite");
ok(pareceCsv("<!DOCTYPE html><html>erro</html>") === false, "HTML de erro recusado");
ok(pareceCsv("") === false && pareceCsv("nada") === false, "corpo vazio/lixo recusado");
ok(TTL_CSV === 300, "TTL do CSV é de 5 minutos");
const regraCsv = validarAlvoCsv(CSV_OK).regra;
ok(anfitriaoFinalPermitido(regraCsv, "doc-04-7s-sheets.googleusercontent.com"),
  "redireccionamento da exportação para googleusercontent é aceite");
ok(anfitriaoFinalPermitido(regraCsv, "evil.example") === false,
  "redireccionamento para fora do Google continua recusado");
ok(anfitriaoFinalPermitido(validarAlvo(ESPN_OK).regra, "evil.example") === false,
  "a rota de dados nunca aceita outro anfitrião");

respostaFonte = () => new Response("Data,Competição,Jogo,Linha,Tendência,Total real\n2026-10-01,Girabola,A vs B,2.5,Mais,3",
  { status: 200, headers: { "Content-Type": "text/csv" } });
const csv1 = await chamar(csvAlvo(CSV_OK));
const corpoCsv = await csv1.text();
ok(csv1.status === 200 && csv1.headers.get("content-type").indexOf("text/csv") === 0,
  "CSV servido como text/csv");
ok(corpoCsv.indexOf("Data,Competição") === 0, "corpo do CSV chega intacto");
const csv2 = await chamar(csvAlvo(CSV_OK));
ok(csv2.headers.get("x-mf-estado") === "hit", "2.º pedido do CSV → hit de cache");

respostaFonte = () => new Response("<!DOCTYPE html><html>precisa de login</html>", { status: 200 });
const csvMau = await chamar(csvAlvo(CSV_OK.replace("gid=0", "gid=9")));
ok(csvMau.status === 502, "folha a devolver HTML → 502 (nunca um CSV inventado)");

grupo("Pedidos simultâneos e redireccionamentos");
const URL_SIMULTANEA = "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260901";
let liberarFonte;
const esperaFonte = new Promise((resolve) => { liberarFonte = resolve; });
let chamadasSimultaneas = 0;
globalThis.fetch = async (url) => {
  chamadasSimultaneas++;
  await esperaFonte;
  const resposta = new Response(JSON.stringify({ events: [] }), { status: 200 });
  Object.defineProperty(resposta, "url", { value: String(url) });
  return resposta;
};
const pedidos = [chamar(alvo(URL_SIMULTANEA)), chamar(alvo(URL_SIMULTANEA)), chamar(alvo(URL_SIMULTANEA))];
await new Promise((r) => setTimeout(r, 20));
ok(chamadasSimultaneas === 1, "3 pedidos iguais em simultâneo → 1 só ida à fonte (" + chamadasSimultaneas + ")");
liberarFonte();
const respostas = await Promise.all(pedidos);
ok(respostas.every((r) => r.status === 200), "os 3 pedidos recebem resposta 200");
ok(cacheFake.puts > 0, "a resposta foi guardada na cache");

globalThis.fetch = async (url) => {
  chamadasFonte++;
  const resposta = respostaDe("https://exemplo-malicioso.example/x", JSON.stringify({ events: [] }), { status: 200 });
  return resposta;
};
const redireccionado = await chamar(alvo(
  "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20260801"));
ok(redireccionado.status === 502, "redireccionamento para fora da allowlist → 502");

console.log("\n" + "=".repeat(58));
console.log((falhas ? "✗ " : "✓ ") + (total - falhas) + "/" + total + " verificações passaram");
if (falhas) console.log("   " + falhas + " FALHA(S)");
console.log("=".repeat(58));
process.exit(falhas ? 1 : 0);
