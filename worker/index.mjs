/* =============================================================================
   MENTE FRIA — ponto de entrada do Worker (/api/*)

   Este módulo SÓ exporta o handler: o runtime de Workers interpreta cada
   export do módulo de entrada como handler, e exportar constantes aqui faz o
   arranque falhar ("Incorrect type for map entry"). A lógica testável vive em
   worker/nucleo.mjs.
   ========================================================================== */

import {
  VERSAO_API, validarAlvo, ttlPara, chaveCache, limiteExcedido
} from "./nucleo.mjs";

const CABECALHO_GUARDADO = "x-mf-guardado";

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

async function obterDaFonte(alvo) {
  const resposta = await fetch(alvo.href, {
    headers: { "Accept": "application/json", "User-Agent": "MenteFria/1.0 (+dados)" },
    redirect: "follow"
  });
  if (!resposta.ok) {
    const erro = new Error("a fonte respondeu " + resposta.status);
    erro.status = resposta.status;
    throw erro;
  }
  const texto = await resposta.text();
  JSON.parse(texto); // garante que só guardamos JSON válido
  return texto;
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

    if (url.pathname !== "/api/fonte") return json({ erro: "rota desconhecida" }, 404);
    if (request.method !== "GET") return json({ erro: "método não permitido" }, 405, { Allow: "GET" });
    if (!mesmaOrigem(request, url)) return json({ erro: "origem não autorizada" }, 403);

    if (limiteExcedido(request.headers.get("CF-Connecting-IP") || "desconhecido")) {
      return json({ erro: "demasiados pedidos" }, 429, { "Retry-After": "60" });
    }

    const alvo = validarAlvo(url.searchParams.get("u"));
    if (!alvo) return json({ erro: "alvo não autorizado" }, 400);

    const ttl = ttlPara(alvo.url);
    const chave = new Request(chaveCache(alvo.url), { method: "GET" });
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
            "Content-Type": "application/json; charset=utf-8",
            "X-MF-Estado": "hit",
            "X-MF-Versao": VERSAO_API,
            "Cache-Control": "public, max-age=" + ttl
          }
        });
      }
    }

    try {
      const texto = await obterDaFonte(alvo.url);

      if (cache) {
        const paraGuardar = new Response(texto, {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            [CABECALHO_GUARDADO]: new Date().toISOString(),
            // O Cache API respeita o Cache-Control do que é guardado: aqui é
            // longo de propósito (o stale-if-error precisa do corpo antigo);
            // a frescura é decidida pelo TTL em ttlPara().
            "Cache-Control": "public, max-age=604800"
          }
        });
        const tarefa = cache.put(chave, paraGuardar).catch(() => {});
        if (ctx && ctx.waitUntil) ctx.waitUntil(tarefa);
      }

      return new Response(texto, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
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
            "Content-Type": "application/json; charset=utf-8",
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
};
