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
