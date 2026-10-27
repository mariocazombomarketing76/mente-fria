/* =============================================================================
   MENTE FRIA — CONFIGURAÇÃO CENTRAL (o ÚNICO sítio a editar)

   1) SITE_URL        → domínio público do site. É usado no JavaScript
                        (textos de partilha, rodapé da imagem do card) e é
                        sincronizado, ao carregar cada página, para o
                        canonical, og:url, og:image e twitter:image.
                        Para mudar de domínio: altere AQUI e corra
                        `node tools/sincronizar-site-url.js`, que actualiza
                        também as meta tags estáticas, o sitemap.xml, o
                        robots.txt e o gerador da og-image.

   2) BOOKMAKERS      → casas de apostas parceiras (programa de afiliados).
                        Cada entrada tem: nome, link (copiado tal e qual do
                        parceiro — nunca alterar o parâmetro btag), licenca
                        (n.º de licença ISJ) e ativa (true/false).
                        Acrescente, desactive (ativa: false) ou remova
                        entradas SÓ AQUI: os botões de aposta do card (um por
                        casa ativa, com licença e aviso de comissão), os textos
                        que citam casas e o seletor «Casa» seguem esta lista
                        automaticamente. Os botões não aparecem em mais nenhum
                        sítio do site.
                        Nenhum pedido é feito aos sites das casas.

   3) RESULTS_CSV_URL  → folha do Google Sheets publicada em CSV, para a
                        página «Resultados». Colunas, por esta ordem:
                        Data, Competição, Jogo, Linha, Tendência, Total real.
                        Enquanto mantiver o texto entre parênteses retos
                        [ ], a página Resultados mostra apenas a mensagem
                        neutra «Painel em preparação» (sem pedidos, sem erro).

   Este ficheiro é carregado em TODAS as páginas, antes do script de cada
   página. É vanilla, sem dependências, e nunca lança erro para o utilizador:
   valores por preencher desligam a funcionalidade em vez de partir a página.
   ========================================================================== */

const MF_CONFIG = {
  SITE_URL: "https://mente-fria.goloaovivo.workers.dev",
  BOOKMAKERS: [
    { nome: "Bantubet", link: "https://bantubet.co.ao/affiliates/?btag=2532299", licenca: "B20081200360166656754/ISJ/MF/20", ativa: true },
    { nome: "KwanzaBet", link: "http://kwanzabet.ao/affiliates/?btag=2822934", licenca: "9845204240/153/MF/24", ativa: true }
  ],
  RESULTS_CSV_URL: "https://docs.google.com/spreadsheets/d/1dd2IuvhK8tzg1qlTrryuOkkmsOsoYVVd3cBcC-l8sv4/export?format=csv&gid=0"
};

/* ------------------------------------------------------------------ *
 * Helpers da configuração (usados pelo gerador e pela página Resultados)
 * ------------------------------------------------------------------ */

/** true se o valor ainda é um placeholder tipo "[URL_CSV_GOOGLE_SHEETS]" ou vazio. */
function mfPlaceholder(valor) {
  return typeof valor !== "string" || valor.trim() === "" || /^\[[^\]]*\]$/.test(valor.trim());
}

/** Link válido de casa de apostas: http(s) e sem placeholder. */
function mfLinkValido(link) {
  return typeof link === "string" && /^https?:\/\/\S+$/i.test(link.trim()) && !mfPlaceholder(link.trim());
}

/**
 * Casas ativas (ativa === true E com link válido), por ordem alfabética e
 * sempre no mesmo estilo — nenhuma é destacada nem «recomendada».
 */
function mfCasasAtivas() {
  const lista = (MF_CONFIG.BOOKMAKERS || []).filter((c) =>
    c && c.ativa === true && mfLinkValido(c.link)
  );
  return lista.slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt"));
}

/**
 * Aviso de comissão obrigatório, com o singular/plural ajustado ao número de
 * casas ativas. Aparece apenas dentro do card, por baixo das opções de aposta.
 */
function mfAvisoComissao(casas) {
  const lista = casas || mfCasasAtivas();
  const linkOuLinks = lista.length === 1 ? "deste link" : "destes links";
  return "Ganhamos comissão se te registares através " + linkOuLinks +
    ". Apostar envolve risco de perda. +18. Joga com responsabilidade.";
}

/** true quando RESULTS_CSV_URL está preenchido com um endereço real. */
function mfCsvConfigurado() {
  return mfLinkValido(MF_CONFIG.RESULTS_CSV_URL);
}

/** Escapa texto para inserção em HTML (necessário ao rodapé dinâmico). */
function mfEscaparHtml(valor) {
  return String(valor == null ? "" : valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Lista legível dos nomes: "Bantubet, KwanzaBet" (pt). */
function mfNomesLegiveis(casas) {
  return (casas || mfCasasAtivas()).map((c) => c.nome).join(", ");
}

/* ------------------------------------------------------------------ *
 * Aplicação automática em todas as páginas (executa ao carregar)
 * ------------------------------------------------------------------ */

(function aplicarMfConfig() {
  /* 1. Textos que citam as casas ativas (rodapé e páginas legais):
        cada página marca os troços dinâmicos com data-casas. */
  function preencherCasas() {
    const nomes = mfNomesLegiveis();
    document.querySelectorAll("[data-casas]").forEach((span) => {
      const modelo = span.getAttribute("data-casas-modelo") || "%s";
      if (nomes) {
        span.textContent = modelo.replace("%s", nomes);
        span.hidden = false;
      } else {
        // Sem casas ativas, o troço (que depende delas) desaparece.
        span.textContent = "";
        span.hidden = true;
      }
    });
  }

  /* 2. Seletor «Casa» do campo Linha da casa (só existe no index). Quando há
        uma única casa ativa o seletor não aparece (a casa fica implícita). */
  function preencherSeletorCasa() {
    const seletor = document.getElementById("campo-casa");
    if (!seletor) return;

    const casas = mfCasasAtivas();
    seletor.innerHTML = casas.map((casa) =>
      '<option value="' + mfEscaparHtml(casa.nome) + '">' + mfEscaparHtml(casa.nome) + "</option>"
    ).join("");
    seletor.hidden = casas.length <= 1;
  }

  /* 3. Metadados absolutos (canonical/og:url/og:image) seguem SITE_URL,
        mesmo que as meta tags estáticas ainda apontem para o domínio antigo. */
  function sincronizarMetadados() {
    const base = String(MF_CONFIG.SITE_URL || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) return;   // placeholder: não toca em nada

    const trocar = (el2) => {
      const href = el2.getAttribute("href") || el2.getAttribute("content") || "";
      if (!href) return;
      const caminho = href.replace(/^https?:\/\/[^\/]+/i, "");  // mantém o path
      const novo = base + caminho;
      if (el2.hasAttribute("href")) el2.setAttribute("href", novo);
      else el2.setAttribute("content", novo);
    };
    document.querySelectorAll('link[rel="canonical"]').forEach(trocar);
    document.querySelectorAll('meta[property="og:url"], meta[property="og:image"],' +
      ' meta[name="twitter:image"]').forEach(trocar);
  }

  function aplicar() {
    try {
      preencherCasas();
      preencherSeletorCasa();
      sincronizarMetadados();
    } catch (erro) {
      // A configuração nunca pode partir a página.
      console.warn("[CONFIG] aplicação parcial:", erro);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", aplicar);
  } else {
    aplicar();
  }
})();
