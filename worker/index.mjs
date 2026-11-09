/* =============================================================================
   MENTE FRIA — Worker de dados (/api/*)

   Responsabilidade única: intermediar e CACHEAR as duas fontes desportivas
   públicas que o site já usava (ESPN e TheSportsDB). Os ficheiros estáticos
   continuam a ser servidos pelo Workers Static Assets; só /api/* entra aqui
   (ver run_worker_first em wrangler.jsonc).

   Porquê: a cache antiga vivia no localStorage de cada visitante, pelo que
   cada pessoa pagava as chamadas à API gratuita dozero. Com esta camada, N
   visitantes do mesmo jogo partilham uma chamada por TTL.

   Limites do plano gratuito (Workers Free):
     • 100 000 pedidos/dia ao Worker;
     • Cache API sem custo adicional, mas POR CENTRO DE DADOS (colo), não uma
       cache única global — dois utilizadores em continentes diferentes podem
       gerar duas chamadas. É cache de borda partilhada, não um CDN de dados
       com consistência global. Não prometemos o contrário.
     • A chave pública "123" da TheSportsDB é partilhada e limitada; por isso
       os TTL das rondas/épocas são longos.

   Segurança: NÃO é um proxy aberto. Só aceita pedidos GET para os caminhos e
   parâmetros de uma lista fechada (REGRAS), recusa parâmetros repetidos e
   origens cruzadas, e limita a frequência por IP (melhor esforço, por isolate).
   ========================================================================== */

export const VERSAO_API = "1.0.0";

const ESPN = "site.api.espn.com";
const TDB = "www.thesportsdb.com";

/* Lista fechada de endpoints. `params` é uma allowlist: qualquer parâmetro
   desconhecido, repetido ou fora do padrão invalida o pedido inteiro. */
const REGRAS = [
  {
    host: ESPN,
    caminho: /^\/apis\/site\/v2\/sports\/(?:soccer|basketball)\/[a-z0-9.\-]{1,40}\/(?:scoreboard|teams\/\d{1,12}\/schedule)$/,
    params: {
      dates: /^\d{8}$/,
      season: /^\d{4}$/
    }
  },
  {
    host: TDB,
    caminho: /^\/api\/v1\/json\/123\/(?:eventsday|eventsround|eventsnextleague|eventsseason)\.php$/,
    params: {
      d: /^\d{4}-\d{2}-\d{2}$/,
      s: /^(?:\d{4}-\d{4}|Soccer|Basketball)$/,
      l: /^\d{1,6}$/,
      r: /^\d{1,3}$/,
      id: /^\d{1,6}$/
    }
  }
];

/** Data de hoje em UTC, no formato YYYY-MM-DD. */
export function hojeUTC(agora) {
  return new Date(agora === undefined ? Date.now() : agora).toISOString().slice(0, 10);
}

/**
 * Valida um alvo. Devolve { url, regra } ou null.
 * Rejeita: outro esquema, outro anfitrião, caminho fora da lista, parâmetro não
 * permitido, parâmetro repetido, valor fora do padrão e credenciais na URL.
 */
export function validarAlvo(bruto) {
  if (typeof bruto !== "string" || bruto.length > 600) return null;

  let alvo;
  try {
    alvo = new URL(bruto);
  } catch (erro) {
    return null;
  }

  if (alvo.protocol !== "https:") return null;
  if (alvo.username || alvo.password) return null;

  const regra = REGRAS.find((r) => r.host === alvo.hostname);
  if (!regra) return null;
  if (!regra.caminho.test(alvo.pathname)) return null;

  const vistos = Object.create(null);
  for (const [chave, valor] of alvo.searchParams) {
    const permitido = regra.params[chave];
    if (!permitido || !permitido.test(valor)) return null;
    if (vistos[chave]) return null; // parâmetro repetido
    vistos[chave] = true;
  }

  return { url: alvo, regra };
}

/**
 * TTL (segundos) por tipo de dado. Ajustado ao que muda e quando:
 *   • jogos de HOJE: 15 min (marcadores mexem);
 *   • calendário futuro: 6 h;
 *   • resultados de dias passados: 24 h;
 *   • rondas/épocas da TheSportsDB: 6 h / 7 dias (chave "123" é partilhada);
 *   • histórico de equipa da ESPN: 12 h.
 */
export function ttlPara(url, agora) {
  const hoje = hojeUTC(agora);

  if (url.hostname === TDB) {
    const ficheiro = url.pathname.split("/").pop();
    if (ficheiro === "eventsday.php") {
      const dia = url.searchParams.get("d") || "";
      if (dia === hoje) return 900;
      return dia > hoje ? 21600 : 86400;
    }
    if (ficheiro === "eventsnextleague.php") return 21600;
    if (ficheiro === "eventsround.php") return 21600; // a ronda em curso muda ao fim do dia
    if (ficheiro === "eventsseason.php") return 604800;
  }

  if (/\/scoreboard$/.test(url.pathname)) {
    const bruto = url.searchParams.get("dates") || "";
    const iso = bruto.length === 8
      ? bruto.slice(0, 4) + "-" + bruto.slice(4, 6) + "-" + bruto.slice(6, 8)
      : "";
    if (iso === hoje) return 900;
    if (iso && iso > hoje) return 21600;
    return 86400;
  }

  return 43200; // histórico de equipa
}

/** Chave de cache canónica (sem fragmento, parâmetros por ordem de chegada). */
export function chaveCache(url) {
  const limpa = new URL(url.href);
  limpa.hash = "";
  return "https://mente-fria.cache/api/fonte?" + limpa.searchParams.toString() + "&alvo=" +
    encodeURIComponent(limpa.origin + limpa.pathname);
}

/* ---------------------------------------------------------------------------
   Limite de frequência (melhor esforço: memória do isolate, não é global).
   60 pedidos por minuto por IP; o objetivo é travar script que faça laço, não
   fazer contabilidade exacta.
   ------------------------------------------------------------------------ */
const LIMITE_POR_MINUTO = 60;
const registos = new Map(); // ip → { janela, contagem }

export function limiteExcedido(ip, agora) {
  const t = agora === undefined ? Date.now() : agora;
  const janela = Math.floor(t / 60000);
  const registo = registos.get(ip);

  if (!registo || registo.janela !== janela) {
    registos.set(ip, { janela: janela, contagem: 1 });
    if (registos.size > 5000) registos.clear(); // impede crescimento sem limite
    return false;
  }

  registo.contagem += 1;
  return registo.contagem > LIMITE_POR_MINUTO;
}

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
