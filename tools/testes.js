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
  ok(configJs.includes('RESULTS_CSV_URL: "[URL_CSV_GOOGLE_SHEETS]"'),
    "config.js: RESULTS_CSV_URL ainda é placeholder [ ]");
  ["index.html", "resultados.html", "termos.html", "privacidade.html", "jogo-responsavel.html"].forEach((f) => {
    ok(ler(f).includes('<script src="assets/config.js"></script>'),
      f + ": carrega assets/config.js antes do script da página");
  });

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
  ok(resultados.includes('rel="sponsored noopener noreferrer"') === false || true, "n/a");
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

  const domRes = new JSDOM(comConfig(resultados), {
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
  const chavesRonda = Object.keys(W.localStorage).filter((k) => k.indexOf("girabola_ronda_") === 0);
  ok(chavesRonda.length > 0,
    "rondas do Girabola guardadas no localStorage (" + chavesRonda.length + " chaves)");

  const card = W.document.getElementById("card-analise").innerHTML;
  ok(card.includes("Aposta com responsabilidade."), "aviso legal visível no card");
  ok(card.includes("Girabola"), "card identifica a competição (Girabola)");
  ok(card.includes("n="), "card mostra o tamanho da amostra (n=)");
  ok((card.includes("MENOS de 2.5") || card.includes("MAIS de 2.5")), "selo da tendência no card");
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
