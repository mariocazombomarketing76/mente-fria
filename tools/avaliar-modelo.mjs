#!/usr/bin/env node
/* =============================================================================
   MENTE FRIA — avaliação histórica do modelo (offline)

   Uso:  node tools/avaliar-modelo.mjs caminho/para/resultados.csv

   Lê o MESMO CSV da página Resultados (Google Sheets exportado) e mede o
   desempenho, SEM tocar em APIs e SEM inventar dados:

   Colunas obrigatórias (as 6 primeiras, iguais às do painel):
     Data, Competição, Jogo, Linha, Tendência, Total real

   Colunas opcionais (a partir da 7.ª) — necessárias para as métricas de
   calibração; sem elas o relatório diz que não as pode calcular:
     Desporto (futebol|nba), Projeção, Probabilidade Mais (0-100),
     Versão do modelo (ex.: 2.1.0)

   Métricas:
     • acertos/falhas/empates e taxa (acertos ÷ (acertos + falhas));
     • MAE da projeção (quando existe «Projeção»);
     • Brier Score e Log Loss da probabilidade de «Mais» (quando existe);
     • calibração por intervalos de 10 pontos.

   Regras deliberadas:
     • futebol e NBA NUNCA são misturados; versões do modelo também não;
     • totais iguais à linha (push) saem das métricas de probabilidade;
     • com menos de 30 registos resolvidos o relatório avisa que a amostra não
       prova nada — não há aqui nenhuma taxa de acerto «oficial».
   ========================================================================== */

import fs from "node:fs";

/* ------------------------------------------------------------------ */
/* CSV (tolerante: aspas, CRLF, BOM, vírgula)                          */
/* ------------------------------------------------------------------ */
export function partirCsv(texto) {
  const linhas = [];
  let linha = [], campo = "", dentro = false;
  const t = String(texto).replace(/^\uFEFF/, "");

  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dentro) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }
        else dentro = false;
      } else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      linhas.push(linha); linha = [];
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => String(c).trim() !== ""));
}

const numero = (bruto) => {
  const t = String(bruto == null ? "" : bruto).trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
};

/**
 * Converte as linhas do CSV em registos utilizáveis.
 * Devolve { registos, ignoradas, colunas } — nada é inventado: linhas sem data,
 * jogo, linha ou com total/tendência inválidos são contadas e descartadas.
 */
export function lerRegistos(linhasCsv) {
  const primeira = (linhasCsv[0] || []).map((c) => String(c).trim().toLowerCase());
  const cabecalho = primeira[0] === "data";
  const dados = cabecalho ? linhasCsv.slice(1) : linhasCsv;

  let ignoradas = 0;
  const registos = [];

  dados.forEach((l) => {
    const linha = numero(l[3]);
    const tendencia = String(l[4] || "").trim().toLowerCase();
    const totalBruto = String(l[5] == null ? "" : l[5]).trim();
    const total = numero(totalBruto);
    const data = String(l[0] || "").trim();
    const jogo = String(l[2] || "").trim();

    const valido = data && jogo && linha !== null && linha > 0 &&
      ["mais", "menos"].includes(tendencia) &&
      (totalBruto === "" || (total !== null && total >= 0));

    if (!valido) { ignoradas++; return; }

    registos.push({
      data,
      competicao: String(l[1] || "").trim(),
      jogo,
      linha,
      tendencia,
      total: totalBruto === "" ? null : total,
      desporto: String(l[6] || "").trim().toLowerCase() || "não indicado",
      projecao: numero(l[7]),
      probMais: numero(l[8]),
      versao: String(l[9] || "").trim() || "não indicada"
    });
  });

  return { registos, ignoradas, comCabecalho: cabecalho };
}

/** Resultado de um registo: Acertou / Falhou / Empate / Pendente. */
export function avaliar(registo) {
  if (registo.total === null) return "Pendente";
  if (registo.total === registo.linha) return "Empate na linha";
  if (registo.tendencia === "mais") return registo.total > registo.linha ? "Acertou" : "Falhou";
  return registo.total < registo.linha ? "Acertou" : "Falhou";
}

/** Brier e log-loss da probabilidade de «Mais» (ignora push e pendentes). */
export function metricasProbabilidade(registos) {
  let n = 0, brier = 0, logLoss = 0;
  registos.forEach((r) => {
    if (r.total === null || r.total === r.linha) return;
    if (r.probMais === null || r.probMais < 0 || r.probMais > 100) return;
    const p = r.probMais / 100;
    const y = r.total > r.linha ? 1 : 0;
    // 1e-12 evita log(0); o valor é desprezável para o resultado.
    const pc = Math.min(1 - 1e-12, Math.max(1e-12, p));
    brier += Math.pow(pc - y, 2);
    logLoss -= y * Math.log(pc) + (1 - y) * Math.log(1 - pc);
    n++;
  });
  return n ? { n, brier: brier / n, logLoss: logLoss / n } : null;
}

/** Erro absoluto médio da projecção (quando existe). */
export function metricasProjecao(registos) {
  const erros = registos
    .filter((r) => r.total !== null && r.projecao !== null)
    .map((r) => Math.abs(r.projecao - r.total));
  return erros.length ? { n: erros.length, mae: erros.reduce((a, b) => a + b, 0) / erros.length } : null;
}

/** Calibração em intervalos de 10 pontos percentuais. */
export function calibracao(registos) {
  const intervalos = Array.from({ length: 10 }, (_, i) => ({ de: i * 10, n: 0, mais: 0 }));
  registos.forEach((r) => {
    if (r.total === null || r.total === r.linha) return;
    if (r.probMais === null || r.probMais < 0 || r.probMais > 100) return;
    const i = Math.min(9, Math.floor(r.probMais / 10));
    intervalos[i].n++;
    if (r.total > r.linha) intervalos[i].mais++;
  });
  return intervalos.filter((i) => i.n > 0).map((i) => ({
    de: i.de, ate: i.de + 10, n: i.n, observado: (i.mais / i.n) * 100
  }));
}

/** Agrupa por desporto + versão do modelo (nunca mistura). */
export function agrupar(registos) {
  const grupos = new Map();
  registos.forEach((r) => {
    const chave = r.desporto + " · modelo " + r.versao;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(r);
  });
  return grupos;
}

/* ------------------------------------------------------------------ */
function relatar(texto) {
  const { registos, ignoradas } = lerRegistos(partirCsv(texto));
  console.log("\nMENTE FRIA — avaliação histórica do modelo");
  console.log("registos válidos: " + registos.length + " · linhas ignoradas: " + ignoradas);

  if (!registos.length) {
    console.log("\nSem registos válidos: nada a avaliar (nenhum número foi inventado).");
    return;
  }

  agrupar(registos).forEach((lista, chave) => {
    const resolvidos = lista.filter((r) => avaliar(r) !== "Pendente");
    const acertos = resolvidos.filter((r) => avaliar(r) === "Acertou").length;
    const falhas = resolvidos.filter((r) => avaliar(r) === "Falhou").length;
    const empates = resolvidos.filter((r) => avaliar(r) === "Empate na linha").length;
    const denom = acertos + falhas;
    const probs = metricasProbabilidade(resolvidos);
    const proj = metricasProjecao(resolvidos);
    const bins = calibracao(resolvidos);

    console.log("\n■ " + chave);
    console.log("  registos: " + lista.length + " · resolvidos: " + resolvidos.length +
      " · pendentes: " + (lista.length - resolvidos.length));
    console.log("  acertos: " + acertos + " · falhas: " + falhas + " · empates: " + empates +
      " · taxa: " + (denom ? ((acertos / denom) * 100).toFixed(1) + "%" : "—"));
    if (probs) {
      console.log("  Brier: " + probs.brier.toFixed(4) + " · Log Loss: " + probs.logLoss.toFixed(4) +
        " (n=" + probs.n + ", só «Mais»)");
    } else {
      console.log("  Brier/Log Loss: indisponível (falta a coluna «Probabilidade Mais»)");
    }
    if (proj) console.log("  MAE da projeção: " + proj.mae.toFixed(2) + " (n=" + proj.n + ")");
    else console.log("  MAE da projeção: indisponível (falta a coluna «Projeção»)");
    if (bins.length) {
      console.log("  calibração (previsto → observado):");
      bins.forEach((b) => console.log("    " + b.de + "-" + b.ate + "% → " +
        b.observado.toFixed(0) + "% (n=" + b.n + ")"));
    }
    if (denom < 30) {
      console.log("  ⚠ amostra pequena (" + denom + " resolvidos): não prova vantagem nem calibração.");
    }
  });

  console.log("\nLembrete: isto mede o passado. Não é promessa de desempenho futuro.\n");
}

if (process.argv[1] && process.argv[1].endsWith("avaliar-modelo.mjs")) {
  const caminho = process.argv[2];
  if (!caminho) {
    console.error("Uso: node tools/avaliar-modelo.mjs caminho/para/resultados.csv");
    process.exit(2);
  }
  if (!fs.existsSync(caminho)) {
    console.error("Ficheiro não encontrado: " + caminho);
    process.exit(2);
  }
  relatar(fs.readFileSync(caminho, "utf8"));
}
