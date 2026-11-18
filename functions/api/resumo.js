/* =============================================================================
   MENTE FRIA — resumo jornalístico com IA (Workers AI)

   POST /api/resumo  { casa, fora, liga, unidade, lambdaCasa, lambdaFora,
                       projecao, linha, tendencia, casaMarcados, foraSofridos,
                       amostraCasa, amostraFora }
   → 200 { texto, fonte }   (fonte: "ia" | "fallback" | "sem-ia" | "cache")

   Este ficheiro é escrito como Pages Function (`onRequestPost`), mas o site
   publica-se como Worker com assets estáticos: `worker/index.mjs` importa a
   mesma função e serve a rota. Assim há um único sítio com a lógica, e o
   ficheiro continua válido se o projecto passar a Pages.

   Regras que o código garante (não só o prompt):
     • a IA recebe APENAS os números já calculados pelo motor — nunca os inventa;
     • texto com expressão proibida, fora de 90–120 palavras ou vazio → fallback;
     • rodapé legal acrescentado aqui, uma única vez, mesmo que a IA o repita;
     • falha da IA/quota/binding ausente → fallback (o card nunca fica vazio).
   ========================================================================== */

/* O modelo pedido no plano original (@cf/meta/llama-3-8b-instruct) foi
   descontinuado pela Cloudflare em 30/05/2026: a chamada falha de imediato e o
   card cai sempre no texto-modelo. Usa-se o substituto actual recomendado para
   modelos pequenos — bom em português, barato e com retenção zero.
   Trocar de modelo é mudar esta linha. */
export const MODELO_IA = "@cf/google/gemma-4-26b-a4b-it";
const MAX_PEDIDO = 4000;          // caracteres de JSON aceites
const PALAVRAS_MIN = 90;
const PALAVRAS_MAX = 120;
const LIMITE_POR_MINUTO = 6;      // cada chamada gasta neurónios da conta

export const RODAPE =
  "+18 | Joga com responsabilidade | Análise gerada com apoio de IA | Não é garantia de resultado.";

/* Texto-modelo: usado quando a IA falha, estoura a quota, devolve algo fora das
   regras ou quando a validação do cliente rejeita o texto. Já inclui o rodapé. */
export const TEXTO_MODELO =
  "O modelo estatístico analisa o histórico recente de ambas as equipas. " +
  "O ataque da equipa da casa mede forças com a defesa visitante, resultando na " +
  "projeção de golos/pontos esperados. Lembra-te que esta é uma tendência " +
  "estatística baseada nos últimos jogos e não uma previsão absoluta. Gere a tua " +
  "banca com consciência. " + RODAPE;

/* Lista negra do projecto. Variantes no feminino/plural incluídas para não
   deixar passar «garantida» ou «lucros». */
export const EXPRESSOES_PROIBIDAS = [
  "garantido", "garantida", "garantidos", "garantidas",
  "certeza",
  "aposta segura",
  "dica certa",
  "lucro", "lucros",
  "maiores probabilidades",
  "ganhar",
  "vitoria certa"
];

/* ------------------------------------------------------------------ */
/* Texto: normalização, validação e rodapé                            */
/* ------------------------------------------------------------------ */

export function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Verdadeiro se o texto contiver uma expressão da lista negra. */
export function temExpressaoProibida(texto) {
  const alvo = normalizar(texto);
  return EXPRESSOES_PROIBIDAS.some((termo) => {
    const limpo = normalizar(termo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + limpo + "([^a-z0-9]|$)").test(alvo);
  });
}

/** Remove o rodapé (repetido pela IA ou já presente no texto-modelo). */
export function semRodape(texto) {
  return String(texto || "")
    .replace(/\s*\+18\s*\|[^\n]*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Garante exactamente um rodapé, no fim, com uma linha em branco antes. */
export function comRodape(texto) {
  const corpo = semRodape(texto);
  return corpo ? corpo + "\n\n" + RODAPE : RODAPE;
}

export function contarPalavras(texto) {
  const corpo = semRodape(texto);
  return corpo ? corpo.split(/\s+/).filter(Boolean).length : 0;
}

/** A IA às vezes embrulha a resposta em markdown ou em aspas: limpar. */
export function limparResposta(texto) {
  return String(texto || "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^[\s"“”']+|[\s"“”']+$/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** O texto da IA cumpre as regras do projecto? */
export function textoAceitavel(texto) {
  const corpo = semRodape(texto);
  if (!corpo) return false;
  const palavras = contarPalavras(corpo);
  if (palavras < PALAVRAS_MIN || palavras > PALAVRAS_MAX) return false;
  if (temExpressaoProibida(corpo)) return false;
  // Os três blocos são obrigatórios: sem eles o texto não é o que se pediu.
  const n = normalizar(corpo);
  return n.includes("contexto") && n.includes("numeros dizem") && n.includes("cuidado");
}

/* ------------------------------------------------------------------ */
/* Prompt                                                             */
/* ------------------------------------------------------------------ */

function numero(valor, casas) {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return valor.toFixed(casas).replace(".", ",");
}

export function montarPrompt(dados) {
  const unidade = dados.unidade === "pontos" ? "pontos" : "golos";
  const linhas = [
    "- Média de " + unidade + " marcados em casa por " + dados.casa +
      " (últimos jogos): " + (numero(dados.casaMarcados, 1) || "não disponível"),
    "- Média de " + unidade + " sofridos fora por " + dados.fora +
      ": " + (numero(dados.foraSofridos, 1) || "não disponível"),
    "- " + unidade + " esperados da equipa da casa: " + numero(dados.lambdaCasa, 1),
    "- " + unidade + " esperados da equipa visitante: " + numero(dados.lambdaFora, 1),
    "- Projeção total do modelo: " + numero(dados.projecao, 1) + " " + unidade,
    "- Linha de referência: " + numero(dados.linha, 1) + " " + unidade,
    "- Tendência do modelo para essa linha: " + dados.tendencia
  ];

  return [
    "És um jornalista desportivo angolano. Escreve uma análise curta, em português simples de Angola, do jogo " +
      dados.casa + " (casa) contra " + dados.fora + " (fora)" +
      (dados.liga ? ", " + dados.liga : "") + ".",
    "",
    "NÚMEROS CALCULADOS PELO NOSSO MODELO (usa apenas estes; não acrescentes nem inventes outros):",
    linhas.join("\n"),
    "",
    "ESTRUTURA OBRIGATÓRIA — exactamente 3 parágrafos, cada um a começar pelo rótulo:",
    "Contexto: ...",
    "O que os números dizem: ...",
    "Cuidado: ...",
    "",
    "REGRAS:",
    "- Entre 90 e 120 palavras no total.",
    "- Texto corrido. Sem markdown, sem listas, sem emojis, sem aspas.",
    "- Proibido usar: garantido, garantida, certeza, aposta segura, dica certa, lucro, lucros, maiores probabilidades, ganhar, vitória certa.",
    "- Não dês conselhos de aposta, não prometas resultados e não digas que algo é fácil ou seguro.",
    "- Não inventes jogadores, lesões, treinadores, classificações, históricos nem números novos.",
    "- Não escrevas o rodapé legal: o site acrescenta-o."
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Limite por IP e cache de respostas (por isolate)                    */
/* ------------------------------------------------------------------ */

const registos = new Map();
const cacheIa = new Map();          // chave do pedido → { texto, expira }
const TTL_CACHE_IA = 6 * 3600 * 1000;

function limiteExcedido(ip, agora) {
  const t = agora === undefined ? Date.now() : agora;
  const janela = Math.floor(t / 60000);
  const registo = registos.get(ip);
  if (!registo || registo.janela !== janela) {
    registos.set(ip, { janela: janela, contagem: 1 });
    if (registos.size > 2000) registos.clear();
    return false;
  }
  registo.contagem += 1;
  return registo.contagem > LIMITE_POR_MINUTO;
}

function chaveIa(dados) {
  return [dados.casa, dados.fora, dados.liga, dados.unidade, dados.lambdaCasa,
    dados.lambdaFora, dados.projecao, dados.linha, dados.tendencia].join("|");
}

/* ------------------------------------------------------------------ */
/* Validação do pedido                                                */
/* ------------------------------------------------------------------ */

function textoCurto(valor, max) {
  if (typeof valor !== "string") return null;
  const limpo = valor.replace(/\s+/g, " ").trim();
  if (!limpo || limpo.length > (max || 60)) return null;
  return limpo;
}

function lerNumero(valor, min, max) {
  const n = typeof valor === "number" ? valor
    : Number(String(valor === undefined || valor === null ? "" : valor).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export function validarPedido(corpo) {
  if (!corpo || typeof corpo !== "object") return null;

  const casa = textoCurto(corpo.casa);
  const fora = textoCurto(corpo.fora);
  if (!casa || !fora) return null;

  const projecao = lerNumero(corpo.projecao, 0, 400);
  const linha = lerNumero(corpo.linha, 0.01, 400);
  if (projecao === null || linha === null) return null;

  const tendencia = textoCurto(corpo.tendencia, 30);
  if (!tendencia) return null;

  return {
    casa: casa,
    fora: fora,
    liga: textoCurto(corpo.liga, 60) || "",
    unidade: corpo.unidade === "pontos" ? "pontos" : "golos",
    lambdaCasa: lerNumero(corpo.lambdaCasa, 0, 20),
    lambdaFora: lerNumero(corpo.lambdaFora, 0, 20),
    projecao: projecao,
    linha: linha,
    tendencia: tendencia,
    casaMarcados: lerNumero(corpo.casaMarcados, 0, 20),
    foraSofridos: lerNumero(corpo.foraSofridos, 0, 20)
  };
}

/* ------------------------------------------------------------------ */
/* Resposta                                                           */
/* ------------------------------------------------------------------ */

function json(corpo, estado, extra) {
  return new Response(JSON.stringify(corpo), {
    status: estado || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      // Conteúdo gerado para ESTE pedido: não deve ser guardado em cache HTTP.
      "Cache-Control": "no-store"
    }, extra || {})
  });
}

function mesmaOrigem(request, url) {
  const origem = request.headers.get("Origin");
  if (!origem) return true;
  try { return new URL(origem).origin === url.origin; } catch (erro) { return false; }
}

/** Pede o texto à Workers AI. Devolve a string crua (pode ser inválida). */
async function pedirIa(env, prompt) {
  const resposta = await env.AI.run(MODELO_IA, {
    messages: [
      { role: "system", content: "Escreves análises desportivas curtas em português de Angola, sem promessas de resultado." },
      { role: "user", content: prompt }
    ],
    max_tokens: 420,
    temperature: 0.4
  });
  if (!resposta) throw new Error("resposta vazia");
  // O runtime devolve { response } para modelos de texto; alguns devolvem string.
  return typeof resposta === "string" ? resposta : String(resposta.response || "");
}

/* ------------------------------------------------------------------ */
/* Handler                                                            */
/* ------------------------------------------------------------------ */

export async function onRequestPost(context) {
  const request = context.request;
  const env = context.env || {};
  const url = new URL(request.url);

  if (!mesmaOrigem(request, url)) return json({ erro: "origem não autorizada" }, 403);

  const ip = request.headers.get("CF-Connecting-IP") || "desconhecido";
  if (limiteExcedido(ip)) {
    return json({ erro: "demasiados pedidos" }, 429, { "Retry-After": "60" });
  }

  let bruto;
  try { bruto = await request.text(); } catch (erro) { return json({ erro: "corpo ilegível" }, 400); }
  if (bruto.length > MAX_PEDIDO) return json({ erro: "pedido demasiado grande" }, 413);

  let corpo;
  try { corpo = JSON.parse(bruto); } catch (erro) { return json({ erro: "JSON inválido" }, 400); }

  const dados = validarPedido(corpo);
  if (!dados) return json({ erro: "dados do jogo inválidos" }, 400);

  // Sem binding (Pages sem AI, deploy ainda sem a ligação): fallback honesto.
  if (!env.AI || typeof env.AI.run !== "function") {
    return json({ texto: TEXTO_MODELO, fonte: "sem-ia" });
  }

  const chave = chaveIa(dados);
  const guardado = cacheIa.get(chave);
  if (guardado && guardado.expira > Date.now()) {
    return json({ texto: guardado.texto, fonte: "cache" });
  }

  try {
    const cru = limparResposta(await pedirIa(env, montarPrompt(dados)));
    if (!textoAceitavel(cru)) {
      return json({ texto: TEXTO_MODELO, fonte: "fallback" });
    }
    const texto = comRodape(cru);
    if (cacheIa.size > 200) cacheIa.clear();
    cacheIa.set(chave, { texto: texto, expira: Date.now() + TTL_CACHE_IA });
    return json({ texto: texto, fonte: "ia" });
  } catch (erro) {
    // Quota, modelo indisponível, timeout: o card não pode ficar vazio.
    console.error("resumo IA falhou:", String(erro && erro.message || erro));
    return json({ texto: TEXTO_MODELO, fonte: "fallback" });
  }
}

/** Qualquer outro método: 405 explícito (Pages só chama onRequestPost em POST). */
export async function onRequest(context) {
  return json({ erro: "método não permitido" }, 405, { Allow: "POST" });
}

export default { onRequestPost, onRequest };
