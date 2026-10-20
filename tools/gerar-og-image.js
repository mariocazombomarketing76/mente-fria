/* Gera assets/og-image.png (1200x630) — imagem estática para og:image/twitter:image.
   É um artefacto de build: o site em si continua 100% vanilla, sem dependências. */
const { createCanvas, registerFont } = require("canvas");
const fs = require("fs");
const F = "/opt/freestyle/python/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf/";
registerFont(F + "DejaVuSans.ttf", { family: "DVS" });
registerFont(F + "DejaVuSans-Bold.ttf", { family: "DVS", weight: "bold" });
registerFont(F + "DejaVuSansMono.ttf", { family: "DVM" });
registerFont(F + "DejaVuSansMono-Bold.ttf", { family: "DVM", weight: "bold" });

const L = 1200, A = 630;
const c = createCanvas(L, A), ctx = c.getContext("2d");

// Fundo
ctx.fillStyle = "#0d1117"; ctx.fillRect(0, 0, L, A);
const g = ctx.createRadialGradient(L * 0.28, 0, 40, L * 0.28, 0, 900);
g.addColorStop(0, "rgba(0,212,255,0.22)"); g.addColorStop(1, "rgba(0,212,255,0)");
ctx.fillStyle = g; ctx.fillRect(0, 0, L, A);
const g2 = ctx.createRadialGradient(L * 0.95, A, 40, L * 0.95, A, 620);
g2.addColorStop(0, "rgba(255,165,0,0.14)"); g2.addColorStop(1, "rgba(255,165,0,0)");
ctx.fillStyle = g2; ctx.fillRect(0, 0, L, A);

// Moldura ciano
ctx.strokeStyle = "rgba(0,212,255,0.65)"; ctx.lineWidth = 4;
ctx.strokeRect(30, 30, L - 60, A - 60);

// Marca
ctx.textBaseline = "middle"; ctx.textAlign = "left";
ctx.fillStyle = "#00d4ff"; ctx.font = 'bold 40px "DVM", monospace';
ctx.fillText("GOLO AO VIVO ANGOLA", 76, 96);
ctx.fillStyle = "#8b949e"; ctx.font = '22px "DVS", sans-serif';
ctx.fillText("Mente Fria · MATCH X-RAY · FUTEBOL E NBA", 76, 142);

// Selo direita
ctx.textAlign = "right";
ctx.fillStyle = "#ffa500"; ctx.font = 'bold 22px "DVM", monospace';
ctx.fillText("+18", L - 76, 96);
ctx.fillStyle = "#6e7681"; ctx.font = '20px "DVM", monospace';
ctx.fillText("ESTATÍSTICA, NÃO GARANTIA", L - 76, 142);
ctx.textAlign = "left";

// Linha
ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 2;
ctx.beginPath(); ctx.moveTo(76, 182); ctx.lineTo(L - 76, 182); ctx.stroke();

// Manchete
ctx.fillStyle = "#e6edf3"; ctx.font = 'bold 58px "DVS", sans-serif';
ctx.fillText("Não apostes no escuro.", 76, 244);
ctx.fillStyle = "#00d4ff";
ctx.fillText("Aposta com a Mente Fria.", 76, 306);

// Chips de dados
const chips = [
  "Média dos últimos 5 jogos",
  "Forma recente: V · E · D",
  "Tendência Mais/Menos"
];
ctx.font = '22px "DVS", sans-serif';
const LIMITE = L - 152;
let x = 76, y = 356;
chips.forEach((t) => {
  const w = ctx.measureText(t).width + 44;
  if (x + w > L - 76) { x = 76; y += 64; }
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fillRect(x, y, w, 52);
  ctx.strokeStyle = "rgba(0,212,255,0.35)"; ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, 52);
  ctx.fillStyle = "#c9d1d9"; ctx.fillText(t, x + 22, y + 26);
  x += w + 16;
});
void LIMITE;

// Bloco CTA âmbar (largura calculada a partir do texto — nunca transborda)
const cta1 = "Cards de análise para partilhar no WhatsApp";
const cta2 = "PUBLICIDADE · LINK DE AFILIADO";
ctx.font = 'bold 26px "DVS", sans-serif';
const w1 = ctx.measureText(cta1).width;
ctx.font = 'bold 17px "DVM", monospace';
const w2 = ctx.measureText(cta2).width;
const ctaW = Math.max(w1, w2) + 48;
const ctaY = 434;
ctx.fillStyle = "#ffa500"; ctx.fillRect(76, ctaY, ctaW, 84);
ctx.fillStyle = "#1a1200"; ctx.font = 'bold 26px "DVS", sans-serif';
ctx.fillText(cta1, 100, ctaY + 28);
ctx.font = 'bold 17px "DVM", monospace';
ctx.fillText(cta2, 100, ctaY + 60);

// Rodapé (domínio lido de assets/config.js — fonte da verdade)
const fsConfig = fs.readFileSync(require("path").join(__dirname, "..", "assets", "config.js"), "utf8");
const mUrl = fsConfig.match(/SITE_URL:\s*"([^"]+)"/);
const dominio = (mUrl ? mUrl[1] : "https://mente-fria.goloaovivo.workers.dev")
  .replace(/^https?:\/\//, "").replace(/\/+$/, "");
ctx.fillStyle = "#6e7681"; ctx.font = '22px "DVM", monospace';
ctx.fillText(dominio, 76, 566);
ctx.textAlign = "right";
ctx.fillStyle = "#ffa500";
ctx.fillText("Joga com responsabilidade", L - 76, 566);
ctx.textAlign = "left";

fs.writeFileSync(process.argv[2], c.toBuffer("image/png"));
console.log("gerado:", process.argv[2], fs.statSync(process.argv[2]).size, "bytes");
