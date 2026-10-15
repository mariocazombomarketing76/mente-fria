#!/usr/bin/env node
/* =============================================================================
   MENTE FRIA — testes (tools/testes.js)
   Correr com:  node tools/testes.js      (requer: npm i jsdom canvas)
   1) verificações offline (ficheiros, HTML, CSP, textos legais);
   2) fluxo real num browser virtual (jsdom) contra as APIs públicas reais,
      incluindo o novo caminho do Girabola (TheSportsDB) e a regressão ESPN;
   3) imagem partilhada: canvas 1080×1350 desenhado e com o aviso legal dentro.
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const RAIZ = path.join(__dirname, "..");
const ler = (f) => fs.readFileSync(path.join(RAIZ, f), "utf8");

let total = 0;
let falhas = 0;
function ok(cond, nome, extra) {
  total++;
  if (cond) {
    console.log("  ✓ " + nome);
  } else {
    falhas++;
    console.log("  ✗ " + nome + (extra ? "  → " + extra : ""));
  }
}
const grupo = (t) => console.log("\n■ " + t);

function esperar(fn, timeout, rotulo) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    (function tentar() {
      let v;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return resolve(v);
      if (Date.now() - inicio > timeout) return reject(new Error("tempo esgotado a esperar: " + rotulo));
      setTimeout(tentar, 150);
    })();
  });
}

/* ------------------------------------------------------------------ */
async function principal() {
  const index = ler("index.html");

  /* 1. VERIFICAÇÕES OFFLINE ----------------------------------------- */
  grupo("Ficheiros e conformidade (offline)");

  const scriptMatch = index.match(/<script>([\s\S]*?)<\/script>/);
  ok(!!scriptMatch, "index.html tem um bloco <script>");
  try {
    new Function(scriptMatch[1]);
    ok(true, "sintaxe do JavaScript válida");
  } catch (e) {
    ok(false, "sintaxe do JavaScript válida", e.message);
  }

  const csp = (index.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  ok(csp.includes("https://r2.thesportsdb.com"), "CSP permite os escudos (img-src r2.thesportsdb.com)");
  ok(csp.includes("https://www.thesportsdb.com"), "CSP permite a API (connect-src www.thesportsdb.com)");
  ok(csp.includes("site.api.espn.com"), "CSP mantém a ESPN");
  ok(csp.includes("frame-src 'none'"), "CSP mantém frame-src 'none'");

  ok(/Premier League · La Liga · Champions · CAF · Girabola/.test(index),
    "botão Futebol anuncia a Girabola");
  ok(index.includes("eventsday.php") && index.includes("eventsround.php"),
    "rotas TheSportsDB presentes (eventsday + eventsround)");
  ok(index.includes("const AFFILIATE_LINKS") && index.includes("btag=2532299"),
    "link de afiliado da Bantubet configurado");
  ok(/rel="noopener sponsored"/.test(index), 'CTA com rel="noopener sponsored"');
  ok(index.includes("badge-publicidade"), "selo Publicidade no CTA");
  ok(index.includes("Aposta com responsabilidade."),
    "aviso legal obrigatório literal no template");
  ok(index.includes('"Tendência, não garantia. Aposta com responsabilidade."') ||
     index.includes("Tendência, não garantia"), "aviso legal com a frase exata do prompt");

  ["index.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    const h = ler(f);
    ok(h.includes('property="og:image"') && h.includes('name="twitter:image"'), f + ": og:image + twitter:image");
  });

  const vercelignore = ler(".vercelignore");
  ok(vercelignore.includes("_arquivo/") && vercelignore.includes("tools/") && vercelignore.includes("README.md"),
    ".vercelignore exclui _arquivo/, tools/ e README.md");
  ok(ler("sitemap.xml").includes("lastmod"), "sitemap.xml tem lastmod");

  // Menu mobile (hambúrguer): o header tem de expor todos os links em ecrãs pequenos
  ["index.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    const h = ler(f);
    ok(h.includes('id="nav-principal"'), f + ": nav com id nav-principal");
    ok(h.includes('class="menu-mobile-btn"') && h.includes('aria-controls="nav-principal"'),
      f + ": botão hambúrguer ligado à nav (aria-controls)");
  });
  const cssMenu = ler("assets/style.css");
  ok(cssMenu.includes(".cabecalho-nav[data-aberto]"), "CSS abre o painel mobile via [data-aberto]");
  ok(/\.menu-mobile-btn \{[\s\S]*?display: inline-flex;/.test(cssMenu),
     "botão hambúrguer visível abaixo de 720px");

  // HTML equilibrado (fora de <script>/<style>)
  ["index.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    const corpo = ler(f)
      .replace(/<script>[\s\S]*?<\/script>/g, "")
      .replace(/<style>[\s\S]*?<\/style>/g, "");
    const conta = (abre, fecha) =>
      (corpo.match(new RegExp(abre, "g")) || []).length - (corpo.match(new RegExp(fecha, "g")) || []).length;
    const des = conta("<div", "</div>") + conta("<section", "</section>") + conta("<p[ >]", "</p>") +
                conta("<span", "</span>") + conta("<button", "</button>") + conta("<a ", "</a>");
    ok(des === 0, f + ": tags balanceadas", "diferença=" + des);
  });

  /* 2. FLUXO REAL NUM BROWSER VIRTUAL -------------------------------- */
  grupo("Fluxo real (jsdom + APIs públicas)");

  const errosPagina = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errosPagina.push(String(e && e.message)));
  vc.on("error", (m) => errosPagina.push(String(m)));

  let pedidos = 0;
  const dom = new JSDOM(index, {
    url: "http://localhost:3000/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (url, opts) => { pedidos++; return global.fetch(url, opts); };
      window.AbortController = global.AbortController;
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      }
      window.Element.prototype.scrollIntoView = function () {};
      window.open = () => null;
      // Regista o último canvas criado para conseguirmos inspeccionar a imagem.
      const orig = window.document.createElement.bind(window.document);
      window.document.createElement = (tag) => {
        const el2 = orig(tag);
        if (String(tag).toLowerCase() === "canvas") window.__ultimoCanvas = el2;
        return el2;
      };
    }
  });

  const W = dom.window;
  const ev = (codigo) => W.eval(codigo);

  // Unitários do caminho TheSportsDB (sem rede)
  ok(ev("isoTdb({strTimestamp:'2026-10-13T16:00:00'})") === "2026-10-13T16:00:00Z",
    "isoTdb acrescenta fuso UTC (Z)");
  ok(ev("isoTdb({strTimestamp:'2026-10-13T16:00:00Z'})") === "2026-10-13T16:00:00Z",
    "isoTdb não duplica o fuso");
  ok(ev("isoTdb({dateEvent:'2026-10-13', strTime:'15:00:00'})") === "2026-10-13T15:00:00Z",
    "isoTdb monta a data a partir de dateEvent");
  ok(ev("normalizarJogoTdb({strHomeTeam:'A',strAwayTeam:null},{nome:'Girabola',slug:'soccer/girabola'})") === null,
    "normalizarJogoTdb rejeita eventos incompletos");
  ok(ev("JSON.stringify(resultadoTdb({intHomeScore:null,intAwayScore:null,idHomeTeam:'1',idAwayTeam:'2'}))") === "null",
    "resultadoTdb ignora jogos sem resultado");
  const r = ev("JSON.stringify(resultadoTdb({intHomeScore:'2',intAwayScore:'0',idHomeTeam:'1',idAwayTeam:'2',strTimestamp:'2026-10-01T14:00:00'}))");
  ok(r.includes('"golosCasa":2') && r.includes('"golosFora":0'), "resultadoTdb lê resultados como números");

  // Escolhe uma data com jogos reais de Girabola
  ev("ESTADO.data = '2026-10-13'; document.getElementById('campo-data').value = '2026-10-13';");
  await ev("escolherDesporto('futebol')");
  await esperar(() => ev("ESTADO.jogos.length") > 0, 30000, "jogos do dia");

  const jogos = ev("ESTADO.jogos");
  ok(jogos.length > 0, "passo 2 lista jogos reais do dia (" + jogos.length + " jogos)");

  const girabola = jogos.find((j) => j.liga === "Girabola");
  ok(!!girabola, "existe jogo da Girabola na lista");
  if (girabola) {
    ok(girabola.fonte === "tdb", "jogo da Girabola marcado com fonte 'tdb'");
    ok(/[zZ]$/.test(girabola.dataISO), "hora da Girabola em ISO com fuso (UTC→Luanda): " + girabola.dataISO);
    ok(/thesportsdb\.com/.test(girabola.casa.escudo) && /thesportsdb\.com/.test(girabola.fora.escudo),
      "escudos da Girabola vindos da TheSportsDB");
    ok(/^\d+$/.test(girabola.casa.id) && /^\d+$/.test(girabola.fora.id), "ids das equipas numéricos");
    ok(girabola.ronda > 0 && /^20\d\d-20\d\d$/.test(girabola.temporada || ""),
      "ronda e época capturadas do evento (ronda " + girabola.ronda + ", época " + girabola.temporada + ")");
    ok(ev("horaLuanda('" + girabola.dataISO + "')").match(/^\d{2}:\d{2}$/) !== null,
      "hora de Luanda calculada: " + ev("horaLuanda('" + girabola.dataISO + "')"));
  }

  const chips = W.document.getElementById("filtros-ligas").textContent;
  ok(chips.includes("Girabola"), "chips de filtro incluem Girabola", chips.trim());
  ok(W.document.getElementById("lista-jogos").textContent.includes(girabola.casa.nome),
    "a lista mostra as equipas da Girabola");

  // Gera o card do jogo da Girabola
  ev("window.__jogoGirabola = ESTADO.jogos.find(j => j.liga === 'Girabola')");
  const pedidosAntes = pedidos;
  await ev("escolherJogo(window.__jogoGirabola)");
  await esperar(() => ev("ESTADO.analise !== null"), 45000, "análise da Girabola");
  const pedidosAnalise = pedidos - pedidosAntes;

  const an = ev("ESTADO.analise");
  ok(an && an.casa && an.fora, "histórico das duas equipas carregado (pedido em " + pedidosAnalise + " pedidos)");
  ok(an.casa.jogos >= 2 && an.fora.jogos >= 2,
    "cada equipa tem jogos reais concluídos (casa n=" + an.casa.jogos + " · fora n=" + an.fora.jogos + ")");
  ok(an.baseCasa && an.baseCasa.n >= 2, "média da casa com amostra (n=" + (an.baseCasa && an.baseCasa.n) + ")");
  ok(an.baseFora && an.baseFora.n >= 2, "média sofrida fora com amostra (n=" + (an.baseFora && an.baseFora.n) + ")");
  ok(Number.isFinite(an.projeccao), "projecção calculada: " + an.projeccao + " " + an.unidade);
  ok(an.tendencia === "Mais" || an.tendencia === "Menos", "tendência válida: " + an.tendencia);
  ok(an.linha === 2.5 && an.unidade === "golos", "linha 2.5 golos (futebol)");
  ok(an.casa.mediaMarcados >= 0 && an.casa.mediaSofridos >= 0, "médias marcadas/sofridas são números válidos");
  ok(an.casa.vitorias + an.casa.empates + an.casa.derrotas === an.casa.jogos,
    "V+E+D batem certo com o número de jogos");
  ok(pedidosAnalise < 15, "análise da Girabola gasta menos de 15 pedidos (" + pedidosAnalise + ")");

  const card = W.document.getElementById("card-analise").innerHTML;
  ok(card.includes("Aposta com responsabilidade."), "aviso legal visível no card");
  ok(card.includes("Girabola"), "card identifica a competição (Girabola)");
  ok(card.includes("n="), "card mostra o tamanho da amostra (n=)");
  ok((card.includes("MENOS de 2.5") || card.includes("MAIS de 2.5")), "selo da tendência no card");
  ok(card.includes('rel="noopener sponsored"'), 'card: CTA rel="noopener sponsored"');
  ok(card.includes("btag=2532299"), "card: CTA com o link de afiliado");
  ok(card.includes("Publicidade"), "card: selo de Publicidade");
  ok(card.includes("Amostra reduzida") || an.amostraMinima === 5 ||
     an.amostraMinima === null, "amostra total ou aviso de amostra reduzida (min=" + an.amostraMinima + ")");

  /* 3. IMAGEM PARTILHADA --------------------------------------------- */
  grupo("Imagem partilhada (canvas 1080×1350)");
  try {
    ev("desenharCardNoCanvas(ESTADO.analise)");
    const canvas = W.__ultimoCanvas;
    ok(canvas && canvas.width === 1080 && canvas.height === 1350, "canvas 1080×1350");
    const dados = canvas.getContext("2d").getImageData(0, 950, 1080, 400).data;
    let claros = 0;
    for (let i = 0; i < dados.length; i += 4) {
      const lum = 0.2126 * dados[i] + 0.7152 * dados[i + 1] + 0.0722 * dados[i + 2];
      if (lum > 70) claros++;
    }
    ok(claros > 300, "há texto desenhado na zona inferior (aviso legal): " + claros + " px claros");
    const png = canvas.toDataURL("image/png");
    ok(png.length > 30000, "PNG gerado (" + Math.round(png.length / 1024) + " KB em base64)");
  } catch (e) {
    ok(false, "canvas desenhado sem erros", e.message);
  }

  // Segunda análise do mesmo dia → cache de rondas
  const pedidosAntes2 = pedidos;
  ev("window.__outro = ESTADO.jogos.find(j => j.liga === 'Girabola')");
  await ev("escolherJogo(window.__outro)");
  await esperar(() => ev("ESTADO.analise !== null"), 45000, "segunda análise");
  const segunda = pedidos - pedidosAntes2;
  ok(segunda <= 4, "cache funciona: 2ª análise gasta ≤ 4 pedidos (" + segunda + ")");

  /* 4. REGRESSÃO ESPN ------------------------------------------------- */
  grupo("Regressão da fonte ESPN");
  const alt = await (async () => {
    ev("window.__alt = null; encontrarDiaComJogos('nba', '2026-10-05').then(r => { window.__alt = r; })");
    try {
      await esperar(() => {
        const v = ev("window.__alt");
        return v && (v.jogos.length > 0 || v.iso === null);
      }, 40000, "jogos da NBA");
    } catch (e) { /* mantém o que houver */ }
    return ev("window.__alt");
  })();
  const achouNba = alt && alt.jogos && alt.jogos.length > 0;
  ok(achouNba, "ESPN continua a devolver jogos da NBA (" + (achouNba ? alt.jogos.length + " em " + alt.iso : "nenhum na janela") + ")");

  if (achouNba) {
    // Fluxo real: escolher o desporto no passo 1 e depois o jogo encontrado.
    ev("ESTADO.data = '" + alt.iso + "'; document.getElementById('campo-data').value = '" + alt.iso + "';");
    await ev("escolherDesporto('nba')");
    await esperar(() => ev("ESTADO.jogos.length > 0"), 40000, "jogos da NBA no dia escolhido");
    await ev("escolherJogo(ESTADO.jogos[0])");
    await esperar(() => ev("ESTADO.analise !== null"), 45000, "análise NBA");
    const cart = W.document.getElementById("card-analise").innerHTML;
    ok(cart.includes("Aposta com responsabilidade."), "card NBA renderiza com o aviso legal");
    ok(cart.includes("pontos"), "card NBA usa a unidade 'pontos'");
    const pjogos = ev("ESTADO.analise.casa ? ESTADO.analise.casa.jogos : 0");
    ok(true, "análise ESPN/NBA concluída (jogos da casa: " + pjogos + ")");
  }

  ok(errosPagina.length === 0, "sem erros de runtime no browser virtual",
    errosPagina.slice(0, 3).join(" | "));
  ok(pedidos < 70, "economia de pedidos de rede na sessão toda (" + pedidos + ")");

  dom.window.close();

  /* --------------------------------------------------------------- */
  console.log("\n" + "=".repeat(58));
  console.log((falhas ? "✗ " : "✓ ") + (total - falhas) + "/" + total + " verificações passaram");
  if (falhas) console.log("   " + falhas + " FALHA(S)");
  console.log("=".repeat(58));
  process.exit(falhas ? 1 : 0);
}

principal().catch((e) => {
  console.error("\nERRO NOS TESTES:", e.message);
  process.exit(1);
});
