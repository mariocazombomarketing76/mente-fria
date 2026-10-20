/* =============================================================================
   MENTE FRIA — sincroniza SITE_URL (tools/sincronizar-site-url.js)
   Correr com:  node tools/sincronizar-site-url.js [--dry-run]

   O JavaScript do site lê o domínio de assets/config.js (MF_CONFIG.SITE_URL),
   mas as meta tags estáticas (canonical, og:url, og:image, twitter:image), o
   sitemap.xml, o robots.txt e o gerador da og-image continuam a apontar para o
   domínio escrito à mão — é o que os crawlers que não executam JavaScript veem.

   Este script lê SITE_URL do config.js e substitui o domínio antigo em todos
   esses ficheiros, para que trocar de domínio seja:
       1) mudar UMA linha em assets/config.js;
       2) correr  node tools/sincronizar-site-url.js
   Depois:  node tools/testes.js  (a suíte falha se algum domínio ficar por actualizar).
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

/* 1. SITE_URL a partir do config.js (fonte da verdade). */
const config = fs.readFileSync(path.join(RAIZ, "assets", "config.js"), "utf8");
const m = config.match(/SITE_URL:\s*"([^"]+)"/);
if (!m || !/^https?:\/\//.test(m[1])) {
  console.error("ERRO: não encontrei um SITE_URL válido em assets/config.js.");
  process.exit(1);
}
const novo = m[1].replace(/\/+$/, "");

/* 2. Domínios actuais nos ficheiros (qualquer https://… anterior é candidato). */
const ficheiros = [
  "index.html", "resultados.html", "termos.html", "privacidade.html",
  "jogo-responsavel.html", "sitemap.xml", "robots.txt", "tools/gerar-og-image.js"
];

let total = 0;
ficheiros.forEach((f) => {
  const caminho = path.join(RAIZ, f);
  if (!fs.existsSync(caminho)) return;
  const antes = fs.readFileSync(caminho, "utf8");
  // Só toca em URLs que aparentem ser o domínio público do projecto…
  let depois = antes.replace(/https:\/\/[a-z0-9.-]*(?:goloaovivo|mente-fria)[a-z0-9.-]*/gi, novo);
  // …e no gerador da og-image o domínio aparece sem protocolo (rodapé da imagem).
  depois = depois.replace(/"(?:[a-z0-9-]+\.)*(?:goloaovivo\.ao|goloaovivo\.[a-z.]+|mente-fria\.[a-z.]+)"/gi,
    '"' + novo.replace(/^https?:\/\//, "") + '"');
  if (antes !== depois) {
    const n = (antes.match(/https?:\/\//g) || []).length - (depois.match(/https?:\/\//g) || []).length;
    total++;
    console.log((dryRun ? "[dry-run] " : "") + f + ": domínio actualizado (" + novo + ")");
    if (!dryRun) fs.writeFileSync(caminho, depois);
    void n;
  }
});

if (!total) console.log("✓ nada a sincronizar: todos os ficheiros já usam " + novo);
else console.log("\n" + (dryRun ? "[dry-run] " : "") + total + " ficheiro(s) " + (dryRun ? "seriam " : "") + "actualizados.");
console.log("Domínio de referência: " + novo + " (fonte: assets/config.js)");
