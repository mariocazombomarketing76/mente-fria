#!/usr/bin/env node
/* =============================================================================
   MENTE FRIA — bancada offline (tools/testes-offline.js)

   Correr com:  node tools/testes-offline.js

   Corre apenas o que não depende da internet: ficheiros e CSP, matemática
   Poisson, linhas inteiras/push/quartos, baseline e selecção dos 5 jogos,
   cartões, e a página Resultados com um CSV simulado. A rede fica bloqueada:
   se algum teste tentar um pedido, a bancada falha e diz quantos tentou.

   A bancada completa (com APIs reais, jsdom e canvas) é `node tools/testes.js`;
   o Worker tem bancada própria em `node tools/testes-worker.mjs`.
   ========================================================================== */
process.env.MF_OFFLINE = "1";
require("./testes.js");
