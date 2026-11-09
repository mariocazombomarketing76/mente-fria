/* =============================================================================
   MENTE FRIA — ponto de entrada do Worker (/api/*)

   Este módulo SÓ exporta o handler: o runtime de Workers interpreta cada
   export do módulo de entrada como handler, e exportar constantes aqui faz o
   arranque falhar ("Incorrect type for map entry"). A lógica testável vive em
   worker/nucleo.mjs.

   Rotas:
     GET /api/estado        → diagnóstico (versão, tipo de cache)
     GET /api/fonte?u=…     → JSON das fontes desportivas (ESPN, TheSportsDB)
     GET /api/csv?u=…       → CSV da folha de resultados publicada no Google
   ========================================================================== */

import {
  VERSAO_API, validarAlvo, validarAlvoCsv, pareceCsv, ttlPara, chaveCache,
  limiteExcedido, TTL_CSV, anfitriaoFinalPermitido
} from "./nucleo.mjs";

const CABECALHO_GUARDADO = "x-mf-guardado";

/* Pedidos em curso, por chave de cache. Sem isto, dez visitantes que abrem o
   mesmo jogo no mesmo segundo originam dez chamadas à fonte (a cache só é
   preenchida no fim da primeira). Vive na memória do isolate: evita a rajada,
   não substitui a cache de borda. */
const EM_VOO = new Map();

function json(corpo, estado, extra) {
  return new Response(JSON.stringify(corpo), {
    status: estado || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    }, extra || {})
  });
}

/** A mesma origem do pedido: sem CORS aberto, sem chamadas de outros sites. */
function mesmaOrigem(request, url) {
  const origem = request.headers.get("Origin");
  if (!origem) return true; // navegação/curl: sem Origin não há cross-site
  try {
    return new URL(origem).origin === url.origin;
  } catch (erro) {
    return false;
  }
}

/** Erro com estado HTTP próprio, para o handler decidir o que devolver. */
function falha(mensagem, estado) {
  const erro = new Error(mensagem);
  erro.status = estado;
  return erro;
}

/**
 * Vai à fonte. `alvo.regra` fixa o anfitrião permitido; mesmo com
 * redirect:"follow", o anfitrião FINAL tem de continuar na lista — sem isto um
 * redireccionamento transformaria o proxy numa porta para outro sítio.
 */
async function obterTexto(alvo, validarCorpo) {
  const resposta = await fetch(alvo.url.href, {
    headers: { "Accept": "application/json, text/csv;q=0.9, */*;q=0.5", "User-Agent": "MenteFria/1.0 (+dados)" },
    redirect: "follow"
  });

  const final = (() => {
    try { return new URL(resposta.url); } catch (erro) { return null; }
  })();
  if (!final || !anfitriaoFinalPermitido(alvo.regra, final.hostname)) {
    throw falha("a fonte redireccionou para fora da lista", 502);
  }
  if (!resposta.ok) throw falha("a fonte respondeu " + resposta.status, resposta.status);

  const texto = await resposta.text();
  if (!validarCorpo(texto)) throw falha("a fonte devolveu conteúdo inesperado", 502);
  return texto;
}

/** Junta pedidos simultâneos da mesma chave numa única ida à fonte. */
function comDedupe(chave, tarefa) {
  const existente = EM_VOO.get(chave);
  if (existente) return existente;
  const nova = tarefa().finally(() => {
    if (EM_VOO.get(chave) === nova) EM_VOO.delete(chave);
  });
  EM_VOO.set(chave, nova);
  return nova;
}

/**
 * Fluxo comum às duas rotas: cache de borda → fonte → cache.
 * `validarCorpo` garante que só se guarda o que se espera (JSON válido ou CSV).
 */
async function servir(alvo, opcoes, ctx) {
  const ttl = opcoes.ttl;
  const tipo = opcoes.tipo;
  const chave = new Request(chaveCache(alvo.url, opcoes.rota));
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;

  let guardado = null;
  if (cache) {
    try {
      guardado = await cache.match(chave);
    } catch (erro) {
      guardado = null; // cache indisponível: segue para a fonte
    }
  }

  if (guardado) {
    const marca = Date.parse(guardado.headers.get(CABECALHO_GUARDADO) || "");
    const idade = isFinite(marca) ? (Date.now() - marca) / 1000 : Infinity;
    if (idade >= 0 && idade < ttl) {
      return new Response(guardado.body, {
        headers: {
          "Content-Type": tipo,
          "X-MF-Estado": "hit",
          "X-MF-Versao": VERSAO_API,
          "Cache-Control": "public, max-age=" + ttl
        }
      });
    }
  }

  try {
    const texto = await comDedupe(chave.url, () => obterTexto(alvo, opcoes.validarCorpo));

    if (cache) {
      const paraGuardar = new Response(texto, {
        headers: {
          "Content-Type": tipo,
          [CABECALHO_GUARDADO]: new Date().toISOString(),
          // O Cache API respeita o Cache-Control do que é guardado: aqui é
          // longo de propósito (o stale-if-error precisa do corpo antigo);
          // a frescura é decidida pelo TTL em ttlPara()/TTL_CSV.
          "Cache-Control": "public, max-age=604800"
        }
      });
      // Guardar faz parte da resposta: sem o await, dois pedidos seguidos
      // chegavam ambos como «miss» (a escrita ainda ia a caminho). Best-effort:
      // se o Cache API recusar, serve-se a resposta na mesma.
      const tarefa = cache.put(chave, paraGuardar);
      if (ctx && ctx.waitUntil) ctx.waitUntil(tarefa.catch(() => {}));
      try {
        await tarefa;
      } catch (erro) {
        console.log("[CACHE] não foi possível guardar: " + (erro && erro.message));
      }
    }

    return new Response(texto, {
      headers: {
        "Content-Type": tipo,
        "X-MF-Estado": guardado ? "revalidado" : "miss",
        "X-MF-Versao": VERSAO_API,
        "Cache-Control": "public, max-age=" + ttl + ", s-maxage=" + ttl
      }
    });
  } catch (erro) {
    // Stale-if-error: melhor mostrar dados antigos e dizê-lo do que falhar.
    if (guardado) {
      const marca = guardado.headers.get(CABECALHO_GUARDADO);
      return new Response(guardado.body, {
        headers: {
          "Content-Type": tipo,
          "X-MF-Estado": "stale",
          // Cabeçalhos HTTP só aceitam ISO-8859-1: sem acentos nem travessões.
          "X-MF-Aviso": "fonte indisponivel - dados de cache",
          "X-MF-Guardado": marca || "",
          "X-MF-Versao": VERSAO_API,
          "Cache-Control": "no-store" // não prolongar a vida do que já é velho
        }
      });
    }

    const estado = erro.status === 429 ? 429 : 502;
    return json({ erro: "fonte indisponível", detalhe: String(erro.message || erro) }, estado, {
      "X-MF-Versao": VERSAO_API,
      "Retry-After": estado === 429 ? "60" : "30"
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Só /api/* chega aqui (run_worker_first), mas um pedido directo ao Worker
    // também não deve inventar rotas.
    if (!url.pathname.startsWith("/api/")) {
      return env && env.ASSETS ? env.ASSETS.fetch(request) : json({ erro: "rota desconhecida" }, 404);
    }

    if (url.pathname === "/api/estado") {
      return json({ ok: true, versao: VERSAO_API, cache: "borda (por centro de dados)" });
    }

    const csv = url.pathname === "/api/csv";
    if (!csv && url.pathname !== "/api/fonte") return json({ erro: "rota desconhecida" }, 404);
    if (request.method !== "GET") return json({ erro: "método não permitido" }, 405, { Allow: "GET" });
    if (!mesmaOrigem(request, url)) return json({ erro: "origem não autorizada" }, 403);

    // Limite por IP: melhor esforço, por isolate (ver nota no nucleo.mjs).
    if (limiteExcedido(request.headers.get("CF-Connecting-IP") || "desconhecido")) {
      return json({ erro: "demasiados pedidos" }, 429, { "Retry-After": "60" });
    }

    const bruto = url.searchParams.get("u");
    const alvo = csv ? validarAlvoCsv(bruto) : validarAlvo(bruto);
    if (!alvo) return json({ erro: "alvo não autorizado" }, 400);

    if (csv) {
      return servir(alvo, {
        rota: "/api/csv",
        ttl: TTL_CSV,
        tipo: "text/csv; charset=utf-8",
        validarCorpo: pareceCsv
      }, ctx);
    }

    return servir(alvo, {
      rota: "/api/fonte",
      ttl: ttlPara(alvo.url),
      tipo: "application/json; charset=utf-8",
      validarCorpo: (texto) => {
        try { JSON.parse(texto); return true; } catch (erro) { return false; } // só JSON válido
      }
    }, ctx);
  }
};
