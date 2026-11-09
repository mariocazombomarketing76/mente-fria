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
const { loadImage } = require("canvas");

/* Modo offline: `node tools/testes.js --offline` (ou tools/testes-offline.js).
   Não corre nenhum grupo que consulte as APIs reais e bloqueia a rede, para
   que um pedido acidental faça falhar a bancada em vez de passar despercebido. */
const OFFLINE = process.argv.indexOf("--offline") !== -1 || process.env.MF_OFFLINE === "1";
let tentativasRede = 0;
if (OFFLINE) {
  const redeBloqueada = () => {
    tentativasRede++;
    throw new Error("pedido de rede em modo offline");
  };
  globalThis.fetch = redeBloqueada;
}

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

/* Verificações que NÃO puderam ser feitas por causa da fonte externa (ex.:
   TheSportsDB a limitar pedidos). Não contam como falha nem como sucesso: são
   listadas no fim, para ninguém ler «tudo verde» quando algo ficou por provar. */
let inconclusivos = 0;
function inconclusivo(nome) {
  inconclusivos++;
  console.log("  ⚠ " + nome);
}

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

/** Guarda o card HTML real (preenchido) para inspecção visual. */
function guardarCardHtml(cartao) {
  if (!process.env.MF_SALVAR_CARD || !cartao) return;
  const destino = path.resolve(RAIZ, path.dirname(process.env.MF_SALVAR_CARD), "card-preview.html");
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  // A cópia estática não corre a animação do número grande: mostra-se já o
  // valor final (o que o utilizador vê depois de a contagem terminar), para
  // a inspecção não ler «0 golos» num cartão que no site diz «1,7 golos».
  const html = cartao.outerHTML.replace(
    /(data-alvo="([\d.]+)" data-casas="(\d+)">)0</,
    (m, inicio, alvo, casas) =>
      inicio + Number(alvo).toFixed(Number(casas)).replace(".", ",") + "<"
  );
  fs.writeFileSync(destino,
    '<!doctype html><html lang="pt"><head><meta charset="utf-8">' +
    '<title>Card (inspecção)</title>' +
    '<link rel="stylesheet" href="../assets/style.css"></head>' +
    '<body style="background:#0b1220;padding:24px">' + html + "</body></html>");
  console.log("  · HTML do card: " + path.relative(RAIZ, destino));
}

/**
 * A chave gratuita da TheSportsDB ("123") é partilhada e limitada por IP.
 * Devolve true quando o limite está a afectar esta rede — nesse caso o fluxo
 * que depende dela fica por provar, em vez de falhar como se fosse regressão.
 */
async function fonteTdbLimitada() {
  try {
    const r = await fetch("https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-10-13&s=Soccer&l=5229");
    const corpo = await r.text();
    return r.status === 429 || /1015|rate.?limit|too many/i.test(corpo);
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
async function principal() {
  const index = ler("index.html");
  const configJs = ler("assets/config.js");
  const resultados = ler("resultados.html");

  // O jsdom não descarrega <script src>: injecta-se o config.js como script
  // inline, na mesma posição (antes do script da página), como no browser.
  const comConfigDe = (cfg, html) => {
    const tag = '<script src="assets/config.js"></script>';
    if (html.indexOf(tag) === -1) throw new Error("página sem <script src=config.js>");
    return html.replace(tag, "<script>" + cfg + "</script>");
  };
  const comConfig = (html) => comConfigDe(configJs, html);

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
  try {
    new Function(configJs);
    ok(true, "sintaxe do assets/config.js válida");
  } catch (e) {
    ok(false, "sintaxe do assets/config.js válida", e.message);
  }
  try {
    const scriptRes = resultados.match(/<script>([\s\S]*?)<\/script>/);
    new Function(scriptRes[1]);
    ok(true, "sintaxe do JavaScript de resultados.html válida");
  } catch (e) {
    ok(false, "sintaxe do JavaScript de resultados.html válida", e.message);
  }

  /* Configuração central (Bloco 1) */
  ok(configJs.includes('SITE_URL: "https://mente-fria.goloaovivo.workers.dev"'),
    "config.js: SITE_URL com o domínio actual");
  ok(configJs.includes('"Bantubet", link: "https://bantubet.co.ao/affiliates/?btag=2532299"') &&
     configJs.includes('"B20081200360166656754/ISJ/MF/20"'),
    "config.js: Bantubet com link btag e licença exactos");
  ok(configJs.includes('"KwanzaBet", link: "http://kwanzabet.ao/affiliates/?btag=2822934"') &&
     configJs.includes('"9845204240/153/MF/24"'),
    "config.js: KwanzaBet com link btag e licença exactos");
  ok(/RESULTS_CSV_URL: "https:\/\/docs\.google\.com\/spreadsheets\/d\/[^"]+export\?format=csv/.test(configJs),
    "config.js: RESULTS_CSV_URL aponta para a folha real (export CSV)");

  /* Deploy verificado a partir do repo: sem estes dois ficheiros o Worker volta
     a publicar README, tools/ e _arquivo/ (aconteceu até 07/11/2026). */
  const wrangler = ler("wrangler.jsonc");
  ok(/"name": "mente-fria"/.test(wrangler) && /"directory": "\."/.test(wrangler),
    "wrangler.jsonc: Worker 'mente-fria' com os assets na raiz");
  ok(/"compatibility_date": "\d{4}-\d{2}-\d{2}"/.test(wrangler),
    "wrangler.jsonc: data de compatibilidade fixada");
  const assetsIgnore = ler(".assetsignore").split("\n").map((l) => l.trim());
  const internos = ["README.md", "tools", "worker", "_arquivo", "propostas-logo", "wrangler.jsonc", "vercel.json"];
  const emFalta = internos.filter((f) => !assetsIgnore.includes(f));
  ok(emFalta.length === 0, ".assetsignore: ficheiros internos fora do site publicado",
    "em falta: " + emFalta.join(", "));

  ["index.html", "resultados.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    ok(ler(f).includes('<script src="assets/config.js"></script>'),
      f + ": carrega assets/config.js antes do script da página");
  });

  /* 1b. MATEMÁTICA OFFLINE (determinística, sem rede) ---------------- */
  grupo("Poisson e linhas (offline, sem APIs)");

  // Extrai o bloco de matemática do index (de factorial a calcularEquipa) e
  // avalia-o isolado: os valores ficam provados sem depender da internet.
  const inicioMat = index.indexOf("function factorial(n)");
  const fimMat = index.indexOf("function calcularEquipa(jogo");
  ok(inicioMat > 0 && fimMat > inicioMat, "bloco de matemática localizado no index");
  const M = new Function(
    "const LIMITES_MODELO={lambda:40,linha:400,jogosBaseline:6};\n" +
    index.slice(inicioMat, fimMat) +
    "\nreturn {calcularProbabilidadePoisson,poissonCdf,poissonProbability,linhaValida,formatarPct,arredondarPercentagens,formatarNumero,formatarLinha,comUnidade};"
  )();

  // Valores de referência do enunciado (λ = 2.5).
  const pi2 = M.calcularProbabilidadePoisson(2.5, 2.0);
  ok(pi2 && pi2.probMenos === 28.73 && pi2.probPush === 25.65 && pi2.probMais === 45.62,
    "λ=2.5 linha 2.0 → Menos 28,73% / Push 25,65% / Mais 45,62%", JSON.stringify(pi2));
  ok(Math.abs(pi2.probMais + pi2.probPush + pi2.probMenos - 100) < 0.005,
    "linha inteira: as três probabilidades somam 100,00 (push NÃO entra no Menos)");
  const pm25 = M.calcularProbabilidadePoisson(2.5, 2.5);
  ok(pm25 && pm25.probMenos === 54.38 && pm25.probMais === 45.62 && pm25.probPush === 0,
    "λ=2.5 linha 2.5 → Menos 54,38% / Mais 45,62% (sem push)", JSON.stringify(pm25));
  ok(M.formatarPct(45.62) === "45,62" && M.formatarPct(0) === "0,00" && M.formatarPct(100) === "100,00",
    "formatação com vírgula decimal e duas casas (45,62 / 0,00 / 100,00)");
  ok(M.formatarNumero(1.3, 1) === "1,3" && M.formatarNumero(224.66, 1) === "224,7" &&
     M.formatarNumero(1, 1) === "1,0" && M.formatarNumero(0, 1) === "0,0",
    "números com vírgula e as casas pedidas (1,3 / 224,7 / 1,0 / 0,0)");
  ok(M.formatarNumero(NaN, 1) === "—", "valor não numérico mostra travessão, nunca NaN");
  ok(M.formatarLinha(2) === "2" && M.formatarLinha(2.5) === "2,5" && M.formatarLinha(1) === "1",
    "linha inteira sem casas e meio ponto com uma (2 / 2,5 / 1)");
  ok(M.comUnidade(1, "golos", 0) === "1 golo" && M.comUnidade(1, "golos", 1) === "1,0 golos" &&
     M.comUnidade(2.5, "golos", 0) === "2,5 golos" && M.comUnidade(220.5, "pontos", 1) === "220,5 pontos",
    "concordância número/unidade: «1 golo», «1,0 golos», «2,5 golos», «220,5 pontos»");
  ok(Math.abs(M.poissonCdf(2, 2.5) * 100 - 54.38) < 0.01, "CDF exacta λ=2.5 até 2 = 54,38%");
  ok(Math.abs(M.poissonCdf(1, 2.5) * 100 - 28.73) < 0.01, "CDF exacta λ=2.5 até 1 = 28,73%");
  ok(Math.abs(M.poissonProbability(2, 2.5) * 100 - 25.65) < 0.01, "P(X=2) exacta λ=2.5 = 25,65%");
  ok(M.calcularProbabilidadePoisson(2.5, 3.5).probMenos === 75.76, "λ=2.5 linha 3.5 → Menos 75,76%");

  // Parâmetros inválidos: recusados, nunca «estimados».
  ok(M.calcularProbabilidadePoisson(2.5, 2.25) === null, "linha de quarto (2.25) recusada");
  ok(M.calcularProbabilidadePoisson(2.5, 2.75) === null, "linha de quarto (2.75) recusada");
  ok(M.calcularProbabilidadePoisson(-1, 2.5) === null, "λ negativo recusado");
  ok(M.calcularProbabilidadePoisson(NaN, 2.5) === null, "λ não numérico recusado");
  ok(M.calcularProbabilidadePoisson(Infinity, 2.5) === null, "λ infinito recusado");
  ok(M.calcularProbabilidadePoisson(500, 2.5) === null, "λ fora do domínio recusado");
  ok(M.calcularProbabilidadePoisson(2.5, 0) === null, "linha zero recusada");
  ok(M.calcularProbabilidadePoisson(2.5, 9000) === null, "linha absurda recusada");
  ok(Number.isFinite(M.poissonProbability(180, 2.5)) && M.poissonProbability(180, 2.5) >= 0,
    "k=180 não devolve NaN (sem overflow do factorial)");
  ok(M.poissonCdf(200, 2.5) <= 1 && M.poissonCdf(200, 2.5) > 0.99, "CDF grande satura em 1 sem estourar");

  const csp = (index.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
  ok(csp.includes("https://r2.thesportsdb.com"), "CSP permite os escudos (img-src r2.thesportsdb.com)");
  ok(csp.includes("https://www.thesportsdb.com"), "CSP permite a API (connect-src www.thesportsdb.com)");
  ok(csp.includes("site.api.espn.com"), "CSP mantém a ESPN");
  ok(csp.includes("frame-src 'none'"), "CSP mantém frame-src 'none'");

  ok(/Premier League · La Liga · Champions · CAF · Girabola/.test(index),
    "botão Futebol anuncia a Girabola");
  ok(index.includes("eventsday.php") && index.includes("eventsround.php"),
    "rotas TheSportsDB presentes (eventsday + eventsround)");
  ok(configJs.includes("const MF_CONFIG") && configJs.includes("BOOKMAKERS"),
    "configuração de casas centralizada em assets/config.js (MF_CONFIG.BOOKMAKERS)");
  ok(index.includes("blocoCasasCard()") && index.includes("mfCasasAtivas()"),
    "opções de aposta do card geradas a partir das casas ativas do config");

  /* Partilha social (WhatsApp + Facebook) e Open Graph do card */
  ok(index.includes('<meta property="og:title" content="Match X-Ray by Mente Fria" />'),
    "index: og:title «Match X-Ray by Mente Fria»");
  ok(index.includes('content="Estatística dos últimos 5 jogos para decidires com mais informação. ' +
     'Estatística, não garantia. +18"'),
    "index: og:description com o texto sugerido");
  ok(index.includes('id="btn-partilhar"') && index.includes("📲 Partilhar no WhatsApp"),
    "botão do WhatsApp mantém-se igual");
  ok(index.includes('id="btn-partilhar-facebook"') && index.includes("Partilhar no Facebook"),
    "novo botão «Partilhar no Facebook» no card");
  ok(index.includes('https://www.facebook.com/sharer/sharer.php?u='),
    "Facebook: sharer oficial só com o parâmetro u");
  ok(index.includes('analise.jogo.fora.nome + ". Vê mais em " + linkPartilha("whatsapp")'),
    "texto do WhatsApp usa o link com UTM do WhatsApp");
  ok(!/btag/.test(index.slice(index.indexOf("function linkPartilha"), index.indexOf("function partilharFacebook"))),
    "links de partilha sem parâmetros de afiliado");
  ok(/async function fetchWithCache\(cacheKey, apiUrl, ttlHours/.test(index),
    "index.html tem a função fetchWithCache (cache localStorage com TTL)");
  ok(index.includes('rel="sponsored noopener noreferrer"'),
    'opções de aposta com rel="sponsored noopener noreferrer"');
  ok(index.includes("card-casas-selo"), "selo Publicidade nas opções do card");
  ok(index.includes("Aposta com responsabilidade."),
    "aviso legal obrigatório literal no template");
  ok(index.includes('"Tendência, não garantia. Aposta com responsabilidade."') ||
     index.includes("Tendência, não garantia"), "aviso legal com a frase exata do prompt");

  ["index.html", "resultados.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    const h = ler(f);
    ok(h.includes('property="og:image"') && h.includes('name="twitter:image"'), f + ": og:image + twitter:image");
    // Open Graph completo, com a imagem genérica da marca, para o Facebook.
    ok(['og:title', 'og:description', 'og:image', 'og:url'].every((p) => h.includes('property="' + p + '"')),
      f + ": as 4 meta Open Graph (title, description, image, url)");
    ok(h.includes('og:image" content="https://mente-fria.goloaovivo.workers.dev/assets/og-image.png"'),
      f + ": og:image é a imagem genérica da marca");
    // Marca (Bloco 2): marca principal + ferramenta + metadados.
    ok(h.includes("GOLO AO VIVO ANGOLA") && h.includes("marca-ferramenta"), f + ": cabeçalho com Golo Ao Vivo Angola · Mente Fria");
    ok(h.includes('og:site_name" content="Golo Ao Vivo Angola · Mente Fria"'), f + ": og:site_name com a marca");
    ok(h.includes("Não apostes no escuro. Aposta com a Mente Fria."), f + ": slogan mantido");
    // Personagem virtual (Bloco 4).
    ok(h.includes("Edson Almeida é uma personagem virtual do Golo Ao Vivo Angola"), f + ": divulgação da personagem virtual");
    // Textos dinâmicos das casas (Bloco 5) e menu com Resultados (Bloco 7/8).
    ok(h.includes("data-casas"), f + ": textos de casas dinâmicos (data-casas)");
    ok(h.includes('href="resultados.html"'), f + ": link Resultados no menu/rodapé");
  });
  ok(ler("termos.html").includes("criada com inteligência artificial"),
    "Termos: personagem virtual explicada no corpo do documento");

  /* Bloco 3 — linguagem: nenhuma frase que prometa vantagem nas páginas públicas */
  const proibidas = /maiores probabilidades|melhorar as tuas hipóteses|aposta certa|palpite certo|garantido|ganhar dinheiro|aposta segura/i;
  ["index.html", "resultados.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    ok(!proibidas.test(ler(f)), f + ": sem frases que prometam vantagem");
  });
  ok(index.includes("mostra-te os números para decidires com mais informação"),
    "index: texto reescrito para «mais informação para decidir»");

  /* Bloco 5 — casas de apostas só dentro do card + aviso de comissão */
  ok(!index.includes('id="onde-apostar"') && !index.includes("onde-apostar-lista"),
    "index: sem secção «Onde apostar» fora do card");
  ["index.html", "resultados.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    ok(!ler(f).includes("#onde-apostar"), f + ": rodapé sem link «Onde apostar»");
  });
  ok(index.includes("Licença ISJ n.º "), "licença ISJ por baixo de cada opção do card");
  ok(configJs.includes('"deste link"') && configJs.includes('"destes links"'),
    "aviso de comissão no singular e no plural");
  ok(configJs.includes("Apostar envolve risco de perda. +18. Joga com responsabilidade."),
    "aviso de comissão com a frase obrigatória");
  ok(index.includes("mfAvisoComissao(casas)"),
    "aviso de comissão do card gerado a partir de MF_CONFIG.BOOKMAKERS");
  ["index.html", "resultados.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    ok(!ler(f).includes("data-aviso-comissao"), f + ": sem aviso de comissão no rodapé");
  });

  /* Bloco 6 — campo Linha da casa */
  ok(index.includes('id="campo-linha"') && index.includes('id="campo-casa"'),
    "index: campo Linha da casa + seletor Casa");
  ok(/id="campo-linha"[^>]*step="0\.5"/.test(index), "campo-linha com step 0.5");
  ok(index.includes("Escreve a linha que vês na casa de apostas. Confirma sempre na casa antes de apostar."),
    "nota do campo com a frase obrigatória");
  ok(index.includes("Linha estatística de referência: ") && index.includes("(não é a linha de nenhuma casa)"),
    "card: rótulo da linha de referência");
  ok(index.includes("introduzida às "), "card: rótulo da linha da casa com hora");
  ok(configJs.includes("preencherSeletorCasa") && configJs.includes("hidden = casas.length <= 1"),
    "seletor Casa esconde-se com uma única casa ativa");

  /* Bloco 7 — página Resultados */
  ok(resultados.includes('id="zona-resultados"'), "resultados.html: zona de resultados");
  ok(resultados.includes("Painel em preparação"), "resultados.html: mensagem neutra quando não configurado");
  ok(resultados.includes("Amostra pequena: estes números ainda não provam vantagem estatística."),
    "resultados.html: aviso de amostra pequena");
  ok(resultados.includes("Estatística, não garantia. Resultados passados não preveem resultados futuros."),
    "resultados.html: aviso permanente");
  ok(resultados.includes("Empate na linha") && resultados.includes("Pendente") &&
     resultados.includes("acertos ÷ (acertos + falhas)"),
    "resultados.html: regras de resultado e taxa de acerto");
  ok(resultados.indexOf("btag=") === -1,
    "resultados.html: sem links de afiliado escritos no código (só via MF_CONFIG)");
  ok(/\/resultados</.test(ler("sitemap.xml")) && ler("sitemap.xml").includes("/resultados"),
    "sitemap.xml: inclui /resultados");
  ok(ler("sitemap.xml").split("<loc>").length - 1 === 5, "sitemap.xml: 5 URLs públicas");
  ok(ler("robots.txt").includes("5 páginas"), "robots.txt: texto actualizado para 5 páginas");

  // Nenhum domínio obsoleta nas superfícies públicas (SEO, partilhas e imagem OG)
  ["index.html", "termos.html", "privacidade.html", "jogo-responsavel.html",
   "robots.txt", "sitemap.xml", "tools/gerar-og-image.js"].forEach((f) => {
    ok(ler(f).indexOf("goloaovivo.ao") === -1,
      f + ": sem o domínio antigo goloaovivo.ao");
  });

  /* Faixa desportiva:9 fotos 1600×360 em rotação (base futebol +8 camadas) */
  const FAIXAS = ["futebol", "basket", "champions", "nba-kl", "yamal",
                  "basket-bal", "vinicius", "nba-kings", "basket-defesa"];
  const estilo = ler("assets/style.css");
  FAIXAS.forEach((n) => {
    const jpg = "assets/faixa-" + n + ".jpg";
    ok(fs.existsSync(path.join(RAIZ, jpg)) && estilo.indexOf("faixa-" + n + ".jpg") !== -1 &&
       index.indexOf("faixa-foto--" + n) !== -1,
      "faixa: " + n + " (ficheiro + CSS + camada no index)");
  });
  for (const n of FAIXAS) {
    const faixaImg = await loadImage(path.join(RAIZ, "assets/faixa-" + n + ".jpg"));
    ok(faixaImg.width === 1600 && faixaImg.height === 360,
      "faixa: " + n + " com 1600×360 (" + faixaImg.width + "×" + faixaImg.height + ")");
  }

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

  /* 2. PAINEL DE RESULTADOS (jsdom + CSV simulado) -------------------- */
  /* 1b-bis. BASELINE, AMOSTRA E SELEÇÃO DOS 5 JOGOS (offline) -------- */
  grupo("Baseline e selecção da amostra (offline)");

  // Extrai funções inteiras do index (equilíbrio de chavetas) para as correr
  // isoladas: nada de rede, nada de DOM.
  const extrair = (nome) => {
    const inicio = index.indexOf("function " + nome + "(");
    if (inicio === -1) throw new Error("função não encontrada: " + nome);
    let profundidade = 0;
    for (let k = index.indexOf("{", inicio); k < index.length; k++) {
      if (index[k] === "{") profundidade++;
      else if (index[k] === "}") {
        profundidade--;
        if (!profundidade) return index.slice(inicio, k + 1);
      }
    }
    throw new Error("função sem fim: " + nome);
  };

  const A = new Function(
    "const JOGOS_ANALISADOS=5;\n" +
    "const LIMITES_MODELO={lambda:40,lambdaNba:300,linha:400,jogosBaseline:6};\n" +
    "const BASELINE_REFERENCIA={futebol:2.5,nba:220};\n" +
    "const BASELINE_MINIMO={futebol:1.5,nba:170};\n" +
    "const BASELINE_MAXIMO={futebol:4.5,nba:270};\n" +
    ["media", "ultimosJogos", "baselineDaAmostra", "mediaCompeticao", "confiancaDaAmostra"]
      .map(extrair).join("\n") +
    "\nreturn {baselineDaAmostra, mediaCompeticao, confiancaDaAmostra, ultimosJogos};"
  )();

  const jg = (data, casaId, foraId, golosCasa, golosFora) => ({ data, casaId, foraId, golosCasa, golosFora });
  const histCasa = [
    jg("2026-09-01", "T1", "T3", 2, 0),
    jg("2026-09-02", "T1", "T4", 1, 1),
    jg("2026-09-03", "T1", "T2", 3, 2), // mesmo jogo aparece nos dois históricos
    jg("2026-09-04", "T5", "T1", 0, 1),
    jg("2026-09-05", "T6", "T1", 2, 2)
  ];
  const histFora = [
    jg("2026-09-02", "T7", "T2", 1, 0),
    jg("2026-09-03", "T2", "T8", 0, 2),
    jg("2026-09-03", "T1", "T2", 3, 2), // duplicado exacto (data + casa + fora)
    jg("2026-09-04", "T9", "T2", 2, 1),
    jg("2026-09-05", "T2", "T10", 1, 1)
  ];

  const amostra = A.baselineDaAmostra([histCasa, histFora]);
  ok(amostra.n === 9, "baseline deduplica jogos repetidos nos dois históricos (10 → " + amostra.n + ")");
  ok(amostra.valor === 2.4, "baseline = média dos totais dos jogos únicos (22/9 = " + amostra.valor + ")");

  const semMarcador = A.baselineDaAmostra([[jg("2026-09-06", "T1", "T2", null, 1), jg("2026-09-07", "T1", "T2", NaN, 1)]]);
  ok(semMarcador.n === 0 && semMarcador.valor === null,
    "jogos sem marcador numérico não entram na baseline (n=" + semMarcador.n + ")");

  const baseAmostra = A.mediaCompeticao(amostra, "futebol");
  ok(baseAmostra.origem === "amostra" && baseAmostra.valor === 2.4 && baseAmostra.amostra === 9,
    "9 jogos chegam: média vem da amostra (" + baseAmostra.valor + ")");
  const baseCurta = A.mediaCompeticao({ n: 5, valor: 3.4 }, "futebol");
  ok(baseCurta.origem === "referência" && baseCurta.valor === 2.5,
    "5 jogos (< 6) → referência de 2.5 e o card avisa (" + baseCurta.origem + ")");
  const limitada = A.mediaCompeticao({ n: 6, valor: 0.9 }, "futebol");
  ok(limitada.valor === 1.5 && limitada.limitada === true && limitada.bruto === 0.9,
    "amostra implausível (0.9) limitada ao mínimo de 1.5 golos e assinalada como limitada");
  ok(A.mediaCompeticao({ n: 7, valor: 2.7 }, "futebol").limitada === false,
    "amostra dentro dos limites não é marcada como limitada");
  ok(A.mediaCompeticao({ n: 6, valor: 9 }, "futebol").valor === 4.5,
    "amostra implausível (9) limitada ao máximo de 4.5 golos");
  ok(A.mediaCompeticao({ n: 6, valor: 320 }, "nba").valor === 270 &&
     A.mediaCompeticao({ n: 2, valor: 230 }, "nba").valor === 220,
    "NBA: limites 170–270 e referência 220 sem amostra");
  ok(A.mediaCompeticao(null, "futebol").valor === 2.5, "sem históricos → referência, nunca NaN");

  // Selecção dos 5 jogos: mais recentes, por ordem, sem alterar a origem.
  const sete = [
    jg("2026-09-04", "X", "Y", 1, 0), jg("2026-09-01", "X", "Y", 0, 0),
    jg("2026-09-07", "X", "Y", 2, 2), jg("2026-09-03", "X", "Y", 1, 1),
    jg("2026-09-05", "X", "Y", 3, 0), jg("2026-09-02", "X", "Y", 0, 1),
    jg("2026-09-06", "X", "Y", 1, 2)
  ];
  const cinco = A.ultimosJogos(sete);
  ok(cinco.length === 5, "selecciona exactamente 5 jogos (" + cinco.length + ")");
  ok(cinco.map((j) => j.data).join() === "2026-09-03,2026-09-04,2026-09-05,2026-09-06,2026-09-07",
    "são os 5 MAIS RECENTES, por ordem (" + cinco.map((j) => j.data.slice(5)).join(" ") + ")");
  ok(sete[0].data === "2026-09-04", "não altera a lista original (ordenou uma cópia)");
  ok(A.ultimosJogos([]).length === 0 && A.ultimosJogos(null).length === 0,
    "lista vazia devolve lista vazia (sem erro)");

  const confCheia = A.confiancaDaAmostra(
    { jogos: 5, jogosEmCasa: 5 }, { jogos: 5, jogosFora: 4 }, 9);
  ok(confCheia.nivel === "média" && confCheia.minimo === 4,
    "confiança olha ao conjunto mais fraco (mínimo " + confCheia.minimo + " → " + confCheia.nivel + ")");
  ok(A.confiancaDaAmostra({ jogos: 5, jogosEmCasa: 5 }, { jogos: 5, jogosFora: 5 }, 10).nivel === "alta",
    "5 jogos em casa e 5 fora → confiança alta");
  ok(A.confiancaDaAmostra({ jogos: 2, jogosEmCasa: 1 }, { jogos: 3, jogosFora: 1 }, 3).nivel === "baixa",
    "amostra curta → confiança baixa");
  ok(A.confiancaDaAmostra(null, null, 0).nivel === "sem dados",
    "sem equipas → «sem dados», nunca inventa confiança");

  grupo("Resultados (jsdom + CSV simulado)");

  const csvFixture = [
    "Data,Competição,Jogo,Linha,Tendência,Total real",
    "2026-10-01,Girabola,Petro vs 1º Agosto,2.5,Mais,3",
    "2026-10-05,Girabola,Sagrada vs Interclube,2.5,Menos,2",
    "2026-10-08,NBA,Lakers vs Celtics,220.5,Mais,220.5",
    "2026-10-10,NBA,Heat vs Bucks,215.5,Mais,",
    "2026-10-12,Girabola,Wiliete vs Recreativo,1.5,Menos,4",
    "2026-10-14,NBA,Suns vs Warriors,230.5,Mais,222"
  ].join("\n");

  const vcRes = new VirtualConsole();
  const errosRes = [];
  vcRes.on("jsdomError", (e) => errosRes.push(String(e && e.message)));
  vcRes.on("error", (m) => errosRes.push(String(m)));

  // Este bloco arranca com a configuração em placeholder (funcionalidade
  // desligada); o CSV real é injectado em 2b. Assim o comportamento neutro
  // continua coberto mesmo com a folha já configurada em produção.
  const configSemCsv = configJs.replace(/RESULTS_CSV_URL: "[^"]*"/,
    'RESULTS_CSV_URL: "[URL_CSV_GOOGLE_SHEETS]"');
  const domRes = new JSDOM(comConfigDe(configSemCsv, resultados), {
    url: "https://mente-fria.goloaovivo.workers.dev/resultados.html",
    runScripts: "dangerously",
    virtualConsole: vcRes
  });
  const WR = domRes.window;
  const zonaRes = () => WR.document.getElementById("zona-resultados");

  // 2a. Placeholder [URL_CSV_GOOGLE_SHEETS] → mensagem neutra, sem erro.
  ok(zonaRes().textContent.includes("Painel em preparação"),
    "placeholder do CSV mostra «Painel em preparação»");
  ok(errosRes.length === 0, "placeholder não provoca erros de runtime",
    errosRes.slice(0, 3).join(" | "));

  // 2b. CSV válido simulado → resumo, aviso de amostra pequena e tabela.
  // MF_CONFIG é uma ligação lexical global (const), não uma propriedade de window.
  WR.eval("MF_CONFIG.RESULTS_CSV_URL = 'https://exemplo.invalid/resultados.csv'");
  WR.fetch = async () => ({ ok: true, text: async () => csvFixture });
  await WR.eval("carregarResultados()");

  const caixas = Array.from(zonaRes().querySelectorAll(".resumo-caixa b")).map((b) => b.textContent);
  ok(caixas[0] === "5" && caixas[1] === "2" && caixas[2] === "2" &&
     caixas[3] === "1" && caixas[4] === "50,0%",
    "resumo: 5 resolvidas, 2 acertos, 2 falhas, 1 empate, taxa 50,0% (" + caixas.join(" · ") + ")");
  ok(zonaRes().textContent.includes("Amostra pequena: estes números ainda não provam vantagem estatística."),
    "menos de 30 resolvidas → aviso de amostra pequena");

  const linhasTabela = Array.from(zonaRes().querySelectorAll("tbody tr"));
  ok(linhasTabela.length === 6, "tabela mostra todas as 6 linhas (nenhuma escondida)");
  const primeiraLinha = linhasTabela[0] ? linhasTabela[0].textContent : "";
  const ultimaLinha = linhasTabela.length ? linhasTabela[linhasTabela.length - 1].textContent : "";
  ok(primeiraLinha.includes("Suns") && primeiraLinha.includes("Falhou"),
    "mais recente primeiro (2026-10-14 → Falhou)");
  ok(ultimaLinha.includes("Petro") && ultimaLinha.includes("Acertou"),
    "mais antiga por último (2026-10-01 → Acertou)");
  const resultadosTabela = linhasTabela.map((tr) => tr.textContent);
  ok(resultadosTabela.some((t) => t.includes("Empate na linha")), "empate na linha calculado (220,5 = 220,5)");
  ok(resultadosTabela.some((t) => t.includes("Pendente")), "total vazio → Pendente");
  ok(resultadosTabela.some((tr) => tr.includes("Wiliete") && tr.includes("Falhou")),
    "Menos com total acima da linha → Falhou");
  ok(zonaRes().querySelectorAll(".res-selo.res-acertou").length === 2 &&
     zonaRes().querySelectorAll(".res-selo.res-falhou").length === 2,
    "selos com classes de cor suaves (acertou/falhou)");
  ok(zonaRes().textContent.includes("Estatística, não garantia") === false &&
     WR.document.querySelector("#aviso-permanente").textContent.includes("Estatística, não garantia"),
    "aviso permanente visível na página");

  // 2c. Falha de rede → volta à mensagem neutra sem partir a página.
  WR.fetch = async () => { throw new Error("rede em baixo"); };
  await WR.eval("carregarResultados()");
  ok(zonaRes().textContent.includes("Painel em preparação"),
    "erro no fetch do CSV → «Painel em preparação»");
  domRes.window.close();

  /* 3. FLUXO REAL NUM BROWSER VIRTUAL -------------------------------- */
  if (OFFLINE) {
    console.log("\n■ Fluxo real, imagem e ESPN (omitidos: consultam APIs reais; correr sem --offline)");
  } else {
  grupo("Fluxo real (jsdom + APIs públicas)");

  const errosPagina = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errosPagina.push(String(e && e.message)));
  vc.on("error", (m) => errosPagina.push(String(m)));

  let pedidos = 0;
  const dom = new JSDOM(comConfig(index), {
    url: "http://localhost:3000/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.__pedidosTdb = 0;
      window.fetch = (url, opts) => {
        pedidos++;
        if (String(url).indexOf("thesportsdb.com") !== -1) window.__pedidosTdb++;
        return global.fetch(url, opts);
      };
      window.AbortController = global.AbortController;
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      }
      window.Element.prototype.scrollIntoView = function () {};
      window.open = () => null;
      // Regista o texto desenhado na imagem, para validar o rodapé.
      window.__textosCanvas = [];
      const ctxOriginal = window.HTMLCanvasElement.prototype.getContext;
      window.HTMLCanvasElement.prototype.getContext = function (tipo) {
        const ctx = ctxOriginal.apply(this, arguments);
        if (tipo === "2d" && ctx && !ctx.__mfTextoRegistado) {
          const escrever = ctx.fillText.bind(ctx);
          ctx.fillText = function (texto) {
            window.__textosCanvas.push(String(texto));
            return escrever.apply(null, arguments);
          };
          ctx.__mfTextoRegistado = true;
        }
        return ctx;
      };
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

  // Antes de gerar o card: a home não mostra casas nem botões de aposta.
  ok(W.document.querySelectorAll(".btn-casa").length === 0 &&
     W.document.querySelectorAll('a[href*="btag="]').length === 0,
    "home sem botões nem links de casas antes de gerar o card");
  ok(!W.document.querySelector(".site-footer").textContent.includes("Ganhamos comissão") &&
     !W.document.querySelector("[data-aviso-comissao]"),
    "rodapé: sem aviso de comissão (fica só no card)");
  ok(W.document.getElementById("campo-casa").hidden === false,
    "seletor Casa aparece com 2 casas ativas");

  // Partilha: links com UTM, só o site e sem afiliados.
  const linkWa = ev("linkPartilha('whatsapp')");
  const linkFb = ev("linkPartilha('facebook')");
  ok(linkWa === "https://mente-fria.goloaovivo.workers.dev/?utm_source=whatsapp&utm_medium=share&utm_campaign=card",
    "WhatsApp: link com utm_source=whatsapp, medium=share, campaign=card", linkWa);
  ok(linkFb === "https://mente-fria.goloaovivo.workers.dev/?utm_source=facebook&utm_medium=share&utm_campaign=card",
    "Facebook: link com utm_source=facebook, medium=share, campaign=card", linkFb);
  const urlSharer = ev("linkPartilhaFacebook()");
  ok(urlSharer === "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(linkFb),
    "Facebook: sharer com o link codificado (sem texto pré-preenchido)", urlSharer);
  ok(urlSharer.indexOf("utm_source%3Dfacebook") !== -1 &&
     urlSharer.indexOf("utm_medium%3Dshare") !== -1 &&
     urlSharer.indexOf("utm_campaign%3Dcard") !== -1,
    "Facebook: UTM sobrevivem à codificação do URL");
  ok(!/btag|bantubet|kwanzabet/i.test(linkWa + linkFb + urlSharer),
    "nenhum link partilhado tem afiliados nem nomes de casas");

  // Opções de aposta dentro do card (HTML gerado, sem rede).
  const blocoDuas = ev("blocoCasasCard()");
  ok((blocoDuas.match(/class="btn btn-casa"/g) || []).length === 2,
    "card: uma opção de aposta por casa ativa (2)");
  ok(blocoDuas.indexOf('data-casa="Bantubet"') < blocoDuas.indexOf('data-casa="KwanzaBet"'),
    "card: opções por ordem alfabética");
  ok(blocoDuas.includes('href="https://bantubet.co.ao/affiliates/?btag=2532299"') &&
     blocoDuas.includes('href="http://kwanzabet.ao/affiliates/?btag=2822934"'),
    "card: links de afiliado intactos (btag exacto)");
  ok(blocoDuas.includes("Licença ISJ n.º B20081200360166656754/ISJ/MF/20") &&
     blocoDuas.includes("Licença ISJ n.º 9845204240/153/MF/24"),
    "card: licença ISJ por baixo de cada opção");
  ok((blocoDuas.match(/rel="sponsored noopener noreferrer"/g) || []).length === 2 &&
     (blocoDuas.match(/target="_blank"/g) || []).length === 2,
    "card: novo separador + rel sponsored/noopener/noreferrer");
  ok(blocoDuas.includes("Publicidade") && blocoDuas.includes("Onde apostar"),
    "card: opções identificadas como «Onde apostar · Publicidade»");
  ok(blocoDuas.includes("Ganhamos comissão se te registares através destes links."),
    "card: aviso de comissão (plural) dentro do card");

  // Uma só casa ativa: uma opção, aviso no singular (simulado em memória).
  const blocoUma = ev("(function(){MF_CONFIG.BOOKMAKERS[1].ativa=false;" +
    "var h=blocoCasasCard();MF_CONFIG.BOOKMAKERS[1].ativa=true;return h;})()");
  ok((blocoUma.match(/class="btn btn-casa"/g) || []).length === 1 &&
     blocoUma.includes('data-casa="Bantubet"') && !blocoUma.includes("KwanzaBet"),
    "uma casa ativa: uma só opção, sem a desativada");
  ok(blocoUma.includes("Ganhamos comissão se te registares através deste link. Apostar"),
    "uma casa ativa: aviso de comissão no singular");

  // Página carregada com a KwanzaBet desativada: rodapé e seletor acompanham.
  const configUmaCasa = configJs.replace(/(\{ nome: "KwanzaBet"[^\n]*?)ativa: true/, "$1ativa: false");
  const domUma = new JSDOM(comConfigDe(configUmaCasa, index), {
    url: "http://localhost:3000/",
    runScripts: "dangerously",
    virtualConsole: new VirtualConsole()
  });
  const W1 = domUma.window;
  await esperar(() => W1.document.getElementById("campo-casa").hidden === true,
    5000, "seletor Casa escondido");
  ok(W1.document.querySelectorAll(".btn-casa").length === 0,
    "uma só casa ativa: nenhum botão de aposta na página");
  ok(!W1.document.querySelector(".site-footer").textContent.includes("KwanzaBet"),
    "rodapé deixa de citar a casa desativada");
  ok(!W1.document.querySelector(".site-footer").textContent.includes("Ganhamos comissão"),
    "uma só casa ativa: aviso de comissão continua só no card");
  domUma.window.close();

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

  // A chave gratuita da TheSportsDB é partilhada e limitada por IP: quando
  // responde 429/1015 a lista sai só com as ligas da ESPN. Nesse caso o fluxo
  // do Girabola fica POR PROVAR (inconclusivo), em vez de falhar por culpa de
  // um limite externo — mas também não é apresentado como aprovado.
  const tdbLimitada = await fonteTdbLimitada();

  const girabola = jogos.find((j) => j.liga === "Girabola");
  if (!girabola) {
    if (tdbLimitada) {
      inconclusivo("TheSportsDB limitou os pedidos desta rede (429/1015): fluxo da Girabola, card de futebol e imagem NÃO verificados nesta execução.");
    } else {
      ok(false, "existe jogo da Girabola na lista");
    }
  }

  if (girabola) {
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

  // Os chips só aparecem com 2+ ligas (regra do desenho); com uma única liga ficam escondidos.
  const zonaChips = W.document.getElementById("filtros-ligas");
  const chips = zonaChips.textContent;
  const nligas = ev("(function(){var l=[];ESTADO.jogos.forEach(function(j){if(l.indexOf(j.liga)===-1)l.push(j.liga)});return l.length})()");
  if (nligas < 2) {
    ok(zonaChips.hidden === true && chips.trim() === "",
      "chips escondidos com apenas " + nligas + " liga (regra: só com 2+)");
  } else {
    ok(zonaChips.hidden === false && chips.includes("Girabola"),
      "chips de filtro incluem Girabola", chips.trim());
  }
  ok(W.document.getElementById("lista-jogos").textContent.includes(girabola.casa.nome),
    "a lista mostra as equipas da Girabola");

  // Cache persistente da TheSportsDB (fetchWithCache → localStorage)
  const chaveDia = "girabola_hoje_2026-10-13";
  let guardadoDia = null;
  try { guardadoDia = JSON.parse(W.localStorage.getItem(chaveDia) || "null"); }
  catch (e) { guardadoDia = null; }
  ok(!!guardadoDia && Array.isArray(guardadoDia.data.events) && guardadoDia.data.events.length > 0,
    "lista do dia guardada no localStorage (" + chaveDia + ")");
  const tdbAntes = ev("window.__pedidosTdb");
  await ev("carregarJogosDoDia('futebol', '2026-10-13')");
  const tdbDepois = ev("window.__pedidosTdb");
  ok(tdbDepois === tdbAntes,
    "recarregar o mesmo dia não repete pedidos à TheSportsDB (" + tdbAntes + " → " + tdbDepois + ")");

  // Gera o card do jogo da Girabola
  ev("window.__jogoGirabola = ESTADO.jogos.find(j => j.liga === 'Girabola')");
  const pedidosAntes = pedidos;
  await ev("escolherJogo(window.__jogoGirabola)");
  await esperar(() => ev("ESTADO.analise !== null"), 45000, "análise da Girabola");
  const pedidosAnalise = pedidos - pedidosAntes;

  const an = ev("ESTADO.analise");
  if (!an) {
    const limitadaAgora = await fonteTdbLimitada();
    if (limitadaAgora) {
      inconclusivo("Histórico do Girabola indisponível (TheSportsDB limitou pedidos): verificações do card, da linha e da imagem ficam por provar nesta execução.");
    } else {
      ok(false, "histórico das duas equipas carregado (análise não concluída em " + pedidosAnalise + " pedidos)");
    }
  }
  if (an) {
  ok(an.casa && an.fora, "histórico das duas equipas carregado (pedido em " + pedidosAnalise + " pedidos)");
  ok(an.casa.jogos >= 2 && an.fora.jogos >= 2,
    "cada equipa tem jogos reais concluídos (casa n=" + an.casa.jogos + " · fora n=" + an.fora.jogos + ")");
  ok(an.baseCasa && an.baseCasa.n >= 2, "média da casa com amostra (n=" + (an.baseCasa && an.baseCasa.n) + ")");
  ok(an.baseFora && an.baseFora.n >= 2, "média sofrida fora com amostra (n=" + (an.baseFora && an.baseFora.n) + ")");
  ok(Number.isFinite(an.projeccao), "projecção calculada: " + an.projeccao + " " + an.unidade);
  ok(["Mais", "Menos", "Empate na linha"].indexOf(an.tendencia) !== -1,
    "tendência válida: " + an.tendencia);
  ok(an.linha === 2.5 && an.unidade === "golos", "linha 2.5 golos (futebol)");
  ok(an.casa.mediaMarcados >= 0 && an.casa.mediaSofridos >= 0, "médias marcadas/sofridas são números válidos");
  ok(an.casa.vitorias + an.casa.empates + an.casa.derrotas === an.casa.jogos,
    "V+E+D batem certo com o número de jogos");
  ok(pedidosAnalise < 15, "análise da Girabola gasta menos de 15 pedidos (" + pedidosAnalise + ")");
  const chavesRonda = Object.keys(W.localStorage).filter((k) => k.indexOf("girabola_ronda_") === 0);
  ok(chavesRonda.length > 0,
    "rondas do Girabola guardadas no localStorage (" + chavesRonda.length + " chaves)");

  const card = W.document.getElementById("card-analise").innerHTML;
  ok(card.includes("Aposta com responsabilidade."), "aviso legal visível no card");
  ok(card.includes("Girabola"), "card identifica a competição (Girabola)");
  ok(card.includes("n="), "card mostra o tamanho da amostra (n=)");
  ok(/(MAIS|MENOS|EMPATE NA LINHA) de 2,5 golos/.test(card),
    "selo da tendência no card, com a linha na convenção portuguesa (2,5)");
  ok(!/de 2\.5 golos/.test(card), "o card não mostra a linha com ponto decimal");
  ok(/Projeção estatística: \d+,\d golos/.test(card),
    "projeção no card com vírgula decimal (\"1,5 golos\", nunca \"1.5\")");
  ok(!/Projeção estatística: \d+\.\d/.test(card), "nenhuma projeção com ponto decimal no card");
  ok(card.includes('rel="sponsored noopener noreferrer"'),
    'card: opções de aposta com rel="sponsored noopener noreferrer"');
  ok(card.includes("btag=2532299") && card.includes("btag=2822934"),
    "card: as duas casas com os respetivos links de afiliado");
  ok(card.includes("Publicidade"), "card: selo de Publicidade");
  const botoesCard = W.document.querySelectorAll("#card-casas .btn-casa");
  ok(botoesCard.length === 2 && W.document.querySelectorAll(".btn-casa").length === 2,
    "card real: 2 opções e nenhuma casa fora do card");
  ok(W.document.querySelector("#card-casas .casa-licenca").textContent ===
     "Licença ISJ n.º B20081200360166656754/ISJ/MF/20",
    "card real: licença ISJ visível por baixo do botão");
  ok(card.includes("Amostra reduzida") || an.amostraMinima === 5 ||
     an.amostraMinima === null, "amostra total ou aviso de amostra reduzida (min=" + an.amostraMinima + ")");

  /* Detalhes do modelo Nível 2 (Poisson + golos esperados) no card */
  ok(an.modelo === "2.1.0", "análise identifica a versão do modelo (" + an.modelo + ")");
  ok(typeof an.probMais === "number" && typeof an.probMenos === "number" &&
     Math.abs(an.probMais + an.probMenos - 100) < 0.005,
    "Poisson: probabilidades complementares (Mais " + an.probMais + "% + Menos " + an.probMenos + "% = 100)");
  ok(Number.isFinite(an.lambdaCasa) && Number.isFinite(an.lambdaFora),
    "golos esperados por equipa (" + an.lambdaCasa + " + " + an.lambdaFora + ")");
  ok(card.includes("detalhes-estatisticos") && card.includes("Golos Esperados (Casa)") &&
     card.includes("Golos Esperados (Fora)"), "card mostra os golos esperados das duas equipas");
  const pct = (v) => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
  ok(card.includes("Probabilidade calculada") && card.includes("Mais: " + pct(an.probMais) + "%") &&
     card.includes("Menos: " + pct(an.probMenos) + "%"),
    "card mostra as probabilidades com duas casas (" + pct(an.probMais) + "% / " + pct(an.probMenos) + "%)");

  // Inspecção visual: o card real, tal como o utilizador o vê.
  guardarCardHtml(W.document.querySelector("#card-analise"));

  const classeEsperada = an.tendencia === "Mais" ? "mais" : (an.tendencia === "Menos" ? "menos" : "neutro");
  ok(W.document.querySelector(".sintese-tipo").className === "sintese-tipo " + classeEsperada,
    "selo da tendência com a classe certa (" + classeEsperada + ")");
  ok(/\.sintese-tipo\.neutro\s*\{/.test(ler("assets/style.css")),
    "CSS tem a classe neutro do empate na linha");

  // Empate na linha: a projecção real tem 1 casa decimal (ex.: 2.4) e não é uma
  // linha válida, por isso força-se o valor EXACTO igual à linha (2.5).
  ev("ESTADO.analise.projeccao = 2.5; ESTADO.analise.projeccaoExacta = 2.5; " +
     "document.getElementById('campo-linha').value = '2.5'; reaplicarLinhaCasa();");
  ok(ev("ESTADO.analise.tendencia") === "Empate na linha",
    "projecção exacta igual à linha: tendência fica «Empate na linha» (" + ev("ESTADO.analise.tendencia") + ")");
  const seloEmpate = W.document.querySelector(".sintese-tipo");
  ok(seloEmpate.className === "sintese-tipo neutro" && /^EMPATE NA LINHA de /.test(seloEmpate.textContent),
    "selo do empate na linha com a classe neutro", seloEmpate.textContent);

  // Mudar a linha tem de RECALCULAR as probabilidades (antes só mudava o texto).
  const probsAntes = ev("[ESTADO.analise.probMais, ESTADO.analise.probMenos]");
  const pedidosAntesLinha = pedidos;
  ev("ESTADO.analise.projeccao = 2.3; ESTADO.analise.projeccaoExacta = 2.3; " +
     "document.getElementById('campo-linha').value = '3.5'; reaplicarLinhaCasa();");
  ok(ev("ESTADO.analise.probMenos") > probsAntes[1],
    "linha 2.5 → 3.5 recalcula Menos para cima (" + probsAntes[1] + "% → " + ev("ESTADO.analise.probMenos") + "%)");
  ok(ev("ESTADO.analise.tendencia") === "Menos", "linha 3.5 com projecção 2.3 → tendência Menos");
  ok(pedidos === pedidosAntesLinha, "mudar a linha NÃO faz novos pedidos à API (" + (pedidos - pedidosAntesLinha) + ")");
  ok(W.document.getElementById("card-analise").innerHTML.indexOf("Mais: " + pct(ev("ESTADO.analise.probMais")) + "%") !== -1,
    "card redesenhado com as probabilidades da linha nova");

  // Linha inteira: existe push e as três somam 100.
  ev("document.getElementById('campo-linha').value = '2'; reaplicarLinhaCasa();");
  ok(ev("ESTADO.analise.tipoLinha") === "inteira" && ev("ESTADO.analise.probPush") >= 0,
    "linha inteira (2): push calculado (" + ev("ESTADO.analise.probPush") + "%)");
  ok(Math.abs(ev("ESTADO.analise.probMais + ESTADO.analise.probPush + ESTADO.analise.probMenos") - 100) < 0.005,
    "linha inteira: Mais + Push + Menos = 100,00");
  ok(W.document.querySelector(".detalhe-probs .push") !== null,
    "card mostra o Push quando a linha é inteira");

  // Linha de quarto: recusada com aviso, sem inventar probabilidades.
  ev("document.getElementById('campo-linha').value = '2.25'; reaplicarLinhaCasa();");
  ok(ev("ESTADO.analise.linha") === 2.5, "2.25 recusada: volta à referência de 2.5");
  ok(W.document.getElementById("linha-erro").hidden === false &&
     /quarto/i.test(W.document.getElementById("linha-erro").textContent),
    "aviso explica que a linha de quarto não é suportada");

  ev("document.getElementById('campo-linha').value = ''; reaplicarLinhaCasa();");
  ok(ev("ESTADO.analise.linha") === 2.5 && ev("ESTADO.analise.tipoLinha") === "meio",
    "limpar a linha volta à referência de 2.5 golos (meio ponto)");

  /* 3. IMAGEM PARTILHADA --------------------------------------------- */
  grupo("Imagem partilhada (canvas 1080×1350)");
  try {
    W.__textosCanvas = [];
    ev("desenharCardNoCanvas(ESTADO.analise)");
    const canvas = W.__ultimoCanvas;
    ok(W.__textosCanvas.includes("Estatística, não garantia. +18. Joga com responsabilidade."),
      "imagem: rodapé com «Estatística, não garantia. +18. Joga com responsabilidade.»");
    ok(W.__textosCanvas.some((t) => /Mais \/ Menos \(Poisson\)/.test(t)) &&
       W.__textosCanvas.some((t) => /% \/ [\d.,]+%/.test(t)),
      "imagem: probabilidades Poisson também no cartão exportado",
      W.__textosCanvas.filter((t) => t.indexOf("%") !== -1).join(" | "));
    ok(W.__textosCanvas.some((t) => /modelo \d+\.\d+\.\d+/.test(t)),
      "imagem: versão do modelo visível no cartão exportado");
    ok(W.__textosCanvas.includes("Mente Fria · Golo Ao Vivo Angola"),
      "imagem: rodapé com a marca «Mente Fria · Golo Ao Vivo Angola»");
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

    // Geometria: o aviso tem de caber na caixa e o rodapé na moldura.
    const lay = canvas.__layout || {};
    ok(lay.linhas >= 4, "imagem: cartão com " + lay.linhas + " linhas (estatísticas, forma e Poisson)");
    ok(lay.conclusaoFim <= lay.avisoY,
      "imagem: caixa da conclusão não invade a do aviso (" + lay.conclusaoFim + " ≤ " + lay.avisoY + ")");
    ok(lay.avisoFim <= lay.rodapeY - 20,
      "imagem: aviso legal termina antes do rodapé (" + lay.avisoFim + " ≤ " + (lay.rodapeY - 20) + ")");
    ok(lay.rodapeY <= lay.altura - 62,
      "imagem: rodapé dentro da moldura (" + lay.rodapeY + " ≤ " + (lay.altura - 62) + ")");

    // Inspecção visual opcional: guarda o PNG exportado e uma página com o card
    // HTML, para se poder olhar para os dois (não altera o resultado dos testes).
    if (process.env.MF_SALVAR_CARD) {
      const destino = path.resolve(RAIZ, process.env.MF_SALVAR_CARD);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, Buffer.from(png.split(",")[1], "base64"));
      console.log("  · PNG do cartão: " + process.env.MF_SALVAR_CARD);
    }
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

  }
  }

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
    const projNba = ev("ESTADO.analise.projeccao");
    ok(Number.isFinite(projNba) && pjogos > 0,
      "análise ESPN/NBA concluída com projecção numérica (" + projNba + " pontos, n=" + pjogos + ")");
  }

  ok(errosPagina.length === 0, "sem erros de runtime no browser virtual",
    errosPagina.slice(0, 3).join(" | "));
  ok(pedidos < 70, "economia de pedidos de rede na sessão toda (" + pedidos + ")");

  dom.window.close();
  }

  if (OFFLINE) {
    grupo("Fronteira de rede (modo offline)");
    ok(tentativasRede === 0, "nenhum pedido de rede tentado no modo offline (" + tentativasRede + ")");
  }

  /* --------------------------------------------------------------- */
  console.log("\n" + "=".repeat(58));
  console.log((falhas ? "✗ " : "✓ ") + (total - falhas) + "/" + total + " verificações passaram");
  if (falhas) console.log("   " + falhas + " FALHA(S)");
  if (inconclusivos) {
    console.log("   ⚠ " + inconclusivos + " verificação(ões) por provar (fonte externa indisponível)");
  }
  console.log("=".repeat(58));
  process.exit(falhas ? 1 : 0);
}

principal().catch((e) => {
  console.error("\nERRO NOS TESTES:", e.message);
  process.exit(1);
});
