# 🧠❄️ Mente Fria — Cards de Análise Pré-Jogo (Match X-Ray)

> «Não apostes no escuro. Aposta com a Mente Fria.»

Ferramenta estática que gera **Cards de Análise Pré-Jogo (Match X-Ray)** para jogos de
**Futebol** e **NBA**: escolhe o desporto → escolhe o jogo do dia → recebe um card com a
forma recente das duas equipas, a tendência de Mais/Menos e um botão de partilha para o
WhatsApp (com **imagem real do card**, gerada por canvas no próprio dispositivo).

Site 100% **vanilla** (HTML + CSS + JS, sem frameworks nem bibliotecas externas), pronto
para deploy gratuito na **Vercel**.

---

## 📁 Estrutura do projecto

```
mente-fria/
├── index.html               → gerador de Match X-Ray (página principal)
├── resultados.html          → painel público de resultados (CSV do Google Sheets)
├── privacidade.html         → Política de Privacidade
├── termos.html              → Termos de Uso
├── jogo-responsavel.html    → Jogo Responsável
├── assets/
│   ├── config.js            → CONFIGURAÇÃO CENTRAL (domínio, casas, URL do CSV)
│   ├── style.css            → CSS partilhado pelas 5 páginas
│   ├── favicon.svg          → favicon (floco de neve ciano na aba do navegador)
│   ├── og-image.png         → imagem estática 1200×630 para og:image/twitter:image
│   ├── bg-inicial.svg        → fundo da página inicial (futebol + basquetebol)
│   ├── bg-futebol.svg        → fundo quando o utilizador escolhe ⚽ Futebol
│   └── bg-basket.svg         → fundo quando o utilizador escolhe 🏀 NBA
├── tools/
│   ├── gerar-og-image.js    → script que (re)gera o og-image.png (só para manutenção)
│   ├── sincronizar-site-url.js → propaga SITE_URL (config.js) às meta tags, sitemap,
│   │                            robots.txt e gerador da og-image
│   └── testes.js            → 201 verificações: offline + resultados + fluxo real +
│                              imagem partilhada
├── vercel.json              → configuração de deploy/cabeçalhos na Vercel
├── .vercelignore            → impede o deploy de _arquivo/, tools/ e README.md
├── robots.txt               → indexação
├── sitemap.xml              → sitemap das 5 páginas
├── README.md                → este guia
└── _arquivo/                → versão anterior (backup, não publicada)
```

---

## 🔌 Fonte de dados

Duas APIs públicas, **sem chave** e com CORS aberto — todo o cálculo é feito no
navegador do utilizador, sem servidor e sem custos.

**ESPN** (`site.api.espn.com`) — ligas internacionais e NBA:

| Uso | Endpoint |
|---|---|
| Jogos do dia | `/apis/site/v2/sports/{desporto}/scoreboard?dates=AAAAMMDD` |
| Últimos jogos de uma equipa | `/apis/site/v2/sports/{desporto}/teams/{id}/schedule` |

**TheSportsDB** (`thesportsdb.com`, chave pública `123`) — **Girabola**, que a ESPN não publica:

| Uso | Endpoint |
|---|---|
| Jogos do dia | `/api/v1/json/123/eventsday.php?d=AAAA-MM-DD&s=Soccer&l=5229` |
| Jogos de uma ronda (histórico) | `/api/v1/json/123/eventsround.php?id=5229&r=N&s=AAAA-AAAA` |
| Ronda em curso (reserva) | `/api/v1/json/123/eventsnextleague.php?id=5229` |

> **Porquê por ronda?** A chave gratuita devolve no máximo **15 eventos** em
> `eventsseason.php` e **1 resultado** em `eventslast.php` — não chega para a média dos
> últimos 5 jogos. Cada ronda tem 8 jogos e cada equipa joga uma vez por ronda, pelo que
> **as últimas 6 rondas em cache** cobrem os 5 jogos do cálculo: ~12 pedidos na primeira
> análise e 0 (cache) nas seguintes. Com o `fetchWithCache` essa cache passou a valer
> **entre visitas** (`localStorage`, 1 h), não só dentro da sessão. Se a fonte falhar,
> o card mostra «Dados insuficientes» — nunca inventa números.
>
> A TheSportsDB **não publica cores** para os clubes angolanos: os cards do Girabola usam
> as cores-padrão do tema (`--cor-casa` / `--cor-fora`).

Competições consultadas (editáveis em `COMPETICOES`, no `index.html`):
Premier League (`soccer/eng.1`), La Liga (`soccer/esp.1`), Champions League
(`soccer/uefa.champions`), CAF Champions League (`soccer/caf.champions`),
**Girabola** (`soccer/girabola` → TheSportsDB) e NBA (`basketball/nba`).

---

## ⚙️ Onde editar — `assets/config.js` (o único sítio)

```js
const MF_CONFIG = {
  // Domínio público: canonical, og:url, og:image e links absolutos seguem daqui.
  SITE_URL: "https://mente-fria.goloaovivo.workers.dev",

  // Casas parceiras (programa de afiliados). Acrescente/desactive aqui — a secção
  // «Onde apostar», o aviso de comissão, os textos do rodapé e o seletor «Casa»
  // do gerador seguem esta lista automaticamente. Copie o link tal e qual
  // (nunca altere o parâmetro btag) e indique a licença do ISJ.
  BOOKMAKERS: [
    { nome: "Bantubet", link: "https://bantubet.co.ao/affiliates/?btag=2532299",
      licenca: "B20081200360166656754/ISJ/MF/20", ativa: true },
    { nome: "KwanzaBet", link: "http://kwanzabet.ao/affiliates/?btag=2822934",
      licenca: "9845204240/153/MF/24", ativa: true }
  ],

  // Folha do Google Sheets publicada em CSV (Ficheiro → Partilhar → Publicar na web).
  // Colunas, por esta ordem: Data, Competição, Jogo, Linha, Tendência, Total real.
  // Enquanto for um placeholder [ ], a página Resultados diz «Painel em preparação».
  RESULTS_CSV_URL: "[URL_CSV_GOOGLE_SHEETS]"
};
```

Para mudar de domínio: altere `SITE_URL` acima e corra
`node tools/sincronizar-site-url.js` (actualiza canonical/og:url/og:image das 5 páginas,
`sitemap.xml`, `robots.txt` e o gerador da og-image).

No topo do `index.html` continuam os restantes parâmetros do motor:

```js
// Webhook de analytics (n8n). Vazio = só escreve no console
const ANALYTICS_WEBHOOK = "";

// Linha de referência Mais/Menos por desporto
const OVER_UNDER_LINE = { futebol: 2.5, nba: 220 };

// Quantos jogos recentes entram nas médias
const JOGOS_ANALISADOS = 5;
```

> ⚠️ Se preencher o `ANALYTICS_WEBHOOK`, acrescente também o domínio do webhook ao
> `connect-src` da Content-Security-Policy da `<head>` (em todas as páginas).

### Eventos de analytics registados

`desporto_escolhido`, `filtro_liga`, `jogo_escolhido`, `card_gerado`, `clique_cta_apostar`,
`partilha_whatsapp` (com o modo: `nativo_com_imagem` ou `descarga_mais_wa_me`),
`partilha_whatsapp_cancelada`, `partilha_whatsapp_erro` e `clique_rodape_legal`.

Ao fim de 1–2 semanas, estes dados dizem **qual desporto/liga gera mais cliques de afiliado
por card gerado** — informação para decidir onde investir mais tempo.

---

## 🧮 Como as estatísticas são calculadas

1. Jogos do dia vindos do `scoreboard` da ESPN para a data escolhida;
2. Para cada equipa do jogo, busca-se o histórico recente (`teams/{id}/schedule`); se não
   houver jogos suficientes (habitual na NBA fora de época), tenta-se a época anterior com
   `?season=AAAA`. **No Girabola** o histórico vem das **últimas 6 rondas**
   (`eventsround.php?id=5229&r=…`), porque a chave gratuita da TheSportsDB limita os
   outros endpoints;
3. Só entram jogos **terminados** com resultado válido; calculam-se:
   - **média marcada em casa** (equipa da casa) e **média sofrida fora** (equipa
     visitante) nos últimos 5 jogos — as médias usam o **contexto de jogo** sempre
     que há pelo menos 2 jogos nesse contexto, e só então caem para a média geral
     (o card indica qual dos dois está a ser usado);
   - **forma recente** (sequência de V/E/D em futebol, V/D em NBA);
   - cada número é apresentado com o seu **tamanho de amostra** (`n=`) e, quando
     `n < 5`, o card acrescenta um aviso de *amostra reduzida*;
4. **Tendência:** `média marcada em casa + média sofrida fora` comparada com
   `OVER_UNDER_LINE` → «Tendência: Mais de X» ou «Tendência: Menos de X»;
5. Se uma equipa não tiver histórico suficiente, o card mostra **«Dados insuficientes»** —
   nunca inventa números.

Todos os pedidos usam `AbortController` com **timeout de 8s** e passam por cache:
**em memória** para a ESPN e **`fetchWithCache` no `localStorage`** para a TheSportsDB
(TTL de 1 h na lista do dia e nas rondas; 6 h na ronda em curso e na época), pelo que
visitas repetidas no mesmo dia fazem **zero pedidos** à API gratuita partilhada. O
utilizador nunca fica com o ecrã bloqueado por causa de uma equipa sem dados.

---

## 🧪 Testes

```bash
cd tools && npm i && node testes.js
```

`tools/testes.js` corre **201 verificações** em quatro blocos:

1. **offline** — CSP, `og:image`/`twitter:image` nas 5 páginas, aviso legal literal,
   CTA `rel="sponsored"`, `.vercelignore`, HTML balanceado, sintaxe do JavaScript e
   auditoria da configuração (links `btag` e licenças exactos, sem frases que prometam
   vantagem);
2. **resultados** — abre `resultados.html` num browser virtual: placeholder do CSV →
   «Painel em preparação», CSV simulado → resumo (acertos, falhas, empates, taxa),
   aviso de amostra pequena, tabela completa e falha de rede sem partir a página;
3. **fluxo real** — abre o `index.html` num browser virtual (jsdom) e usa as **APIs
   públicas a sério**: escolhe Futebol, filtra pela Girabola, gera o card de um jogo
   real (média, amostra `n=`, tendência, aviso legal) e faz a regressão ESPN/NBA;
4. **imagem partilhada** — desenha o canvas 1080×1350 e confirma que o aviso legal
   está desenhado **dentro** da imagem.

Requer rede (bate mesmo nas APIs) e `jsdom` + `canvas` locais — ambos em `tools/`,
que está no `.vercelignore` e no `.gitignore` (`node_modules/`).

---

## 📲 Partilha (o motor viral)

- **Telemóvel (Web Share API):** gera a imagem do card no `<canvas>` (1080×1350), converte
  em ficheiro PNG e abre o **menu nativo de partilha** com a imagem já anexada.
- **Desktop / navegador sem suporte:** descarrega a imagem automaticamente e abre o
  `wa.me` com o texto da análise, para anexar a imagem à mão (aberto por clique em
  âncora, para não ser bloqueado como *pop-up*).

O aviso `📊 Estatística baseada nos últimos 5 jogos. Tendência, não garantia.` está sempre
presente **dentro do card e dentro da imagem partilhada**.

O card e a imagem têm ainda a linha de crédito `Match X-Ray by Mente Fria · Golo Ao Vivo
Angola`. Nenhum card ou imagem partilhada contém links de afiliado.

---

## 📊 Resultados (CSV)

`resultados.html` lê `RESULTS_CSV_URL` (Google Sheets publicado em CSV) e calcula tudo no
navegador. Colunas, por esta ordem: **Data, Competição, Jogo, Linha, Tendência, Total real**
(a primeira linha pode ser cabeçalho; `Tendência` = `Mais` ou `Menos`).

- `Acertou` se (Mais e Total > Linha) ou (Menos e Total < Linha);
- `Empate na linha` se Total = Linha; `Falhou` nos restantes casos;
- `Pendente` quando o Total real está vazio.

O resumo mostra resolvidas, acertos, falhas, empates e taxa = acertos ÷ (acertos + falhas),
mais o aviso de amostra pequena abaixo de 30 resolvidas. Nenhuma falha é escondida. Se o
CSV não carregar (ou `RESULTS_CSV_URL` ainda for o placeholder), a página mostra
«Painel em preparação» sem erro.

---

## ✅ Conformidade com a Vercel

Este projecto é um **site estático puro** (HTML + CSS + JS, sem build). Para este tipo de
projecto a Vercel **só exige o `index.html` na raiz** — não é preciso `package.json`,
comando de build nem pasta `dist`.

| Ficheiro | Papel | Vercel |
|---|---|---|
| `index.html` | porta de entrada do site | **obrigatório** |
| `termos.html`, `privacidade.html`, `jogo-responsavel.html`, `resultados.html` | páginas adicionais | opcional |
| `assets/style.css`, `assets/config.js`, `assets/favicon.svg` | CSS, configuração e ícone | opcional |
| `robots.txt`, `sitemap.xml` | indexação nos motores de busca | recomendado |
| `vercel.json` | `cleanUrls`, `trailingSlash` e cabeçalhos de segurança | opcional (recomendado) |
| `.vercelignore` | exclui `_arquivo/` e `README.md` do deploy | opcional (recomendado) |

Não há funções serverless, base de dados nem pasta `api/`, pelo que os limites de execução
(10 s por função no Hobby) e de banda (100 GB/mês) não são problema: o site inteiro ocupa
cerca de 215 KB.

### ⚠️ Ponto crítico: uso comercial exige plano Pro

As [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) (actualizadas
em 14/09/2026) afirmam: «Hobby teams are restricted to non-commercial personal use only.
All commercial usage of the platform requires either a Pro or Enterprise plan», e listam
como uso comercial, entre outros casos:

- «Advertising the sale of a product or service» → o CTA promove os serviços de uma casa de apostas;
- «Affiliate linking is the primary purpose of the site» → a conversão por afiliado é o objectivo do site;
- «The inclusion of advertisements, including … Google AdSense» → os dois blocos de anúncio.

**Conclusão:** com links de afiliado e AdSense activos, este site é uso comercial e **precisa
do plano Pro**. No Hobby corre o risco de o projecto ser suspenso, mesmo que a parte técnica
esteja impecável. Alternativa: manter o Hobby enquanto o site estiver apenas em
pré-visualização, sem links de afiliado activos e sem anúncios.

### Conteúdo de jogo e a Acceptable Use Policy

A [AUP](https://vercel.com/legal/acceptable-use-policy) **não proíbe** conteúdo de apostas
em si. O que pesa é a cláusula «carry out any unlawful purpose», incluindo «sale, promotion
or facilitation of illegal goods and services». Requisitos práticos:

- promover apenas operadores **licenciados** (em Angola, supervisionados pelo ISJ);
- manter o aviso **+18**, a natureza informativa do serviço e a identificação da publicidade
  (selo «Publicidade» no CTA) — tudo já implementado nas 5 páginas;
- sendo o site acessível de fora de Angola, não direccionar links de aposta a jurisdições
  onde o operador não esteja licenciado.

## 🚀 Deploy na Vercel

**Opção A — CLI:**

```bash
npm i -g vercel      # uma só vez
cd mente-fria
vercel               # preview
vercel --prod        # produção
```

**Opção B — GitHub + Vercel:** suba esta pasta para um repositório e ligue-o à Vercel
(Framework Preset: **Other**; sem build command; output = raiz do projecto).

Antes de publicar num domínio próprio, altere `SITE_URL` em `assets/config.js` e corra
`node tools/sincronizar-site-url.js` — as meta tags Open Graph (incluindo
`og:image`/`twitter:image`), o `robots.txt`, o `sitemap.xml` e o `tools/gerar-og-image.js`
são actualizados de uma vez. (Em runtime, o `config.js` também já corrige canonical,
`og:url`, `og:image` e `twitter:image` sozinho.)

---

## 🎨 Camada visual (v4.2 + v4.3)

Tudo vanilla, sem bibliotecas:

| Peça | O que faz |
|---|---|
| **Fundo por desporto** | `body.fundo-inicial / fundo-futebol / fundo-nba` trocam a imagem de fundo (SVG próprio, ~3 KB cada) com transição suave; vêu escuro para o texto continuar legível |
| **Cores das equipas** | `team.color` da ESPN → `--cor-casa` / `--cor-fora` no card (halo no escudo, barra sob o nome, gradiente no confronto) e **barras de cor na imagem partilhada**. Cores escuras (ex.: preto) caem para as cores-padrão do tema |
| **Barras de intensidade** | cada média mostra uma barra proporcional (escala: 4 golos · 130 pontos) |
| **Pílulas V/E/D** | forma recente em blocos coloridos, do mais recente para o mais antigo |
| **Sparkline** | gráfico SVG inline com a série *marcados* (ciano) e *sofridos* (vermelho tracejado) dos últimos jogos + máximo |
| **Número gigante da projecção** | contagem animada até ao valor final (respeta `prefers-reduced-motion`) ao lado do medidor projecção-vs-linha |
| **Filtros por competição** | chips "Todas · Premier · La Liga · …" acima da lista, com contagem de jogos |

> As imagens de fundo são **SVG desenhado de raiz** (campo, quadra e bolas) — nada de
> fotografias de terceiros, pelo que não há questões de licença nem peso extra
> (3 KB cada). Se quiser fotografias reais, usa imagens com licença livre e coloca-as
> em `assets/` referenciadas no CSS.

## 🖼️ Imagem de partilha do link (og:image)

O link do site partilhado no WhatsApp/Telegram/facebook usa `assets/og-image.png`
(1200×630, gerada com o mesmo tema do site). Está referenciada em `og:image` e
`twitter:image` nas 5 páginas — **sem esta imagem, o `twitter:card=summary_large_image`
sai sem foto** e a partilha do link tem muito menos impacto.

Para a regerar (só é preciso se mudar o visual):

```bash
cd tools && npm i canvas && node gerar-og-image.js ../assets/og-image.png
```

`tools/` está no `.vercelignore`, pelo que este script nunca é publicado.

## 💰 Google AdSense

Os blocos já existem no `index.html` com altura fixa (para não haver layout shift):

- `#ad-slot-top` — leaderboard, depois do cabeçalho;
- `#ad-slot-below-card` — in-article, abaixo do Card de Análise (nunca dentro do card).

Para activar: cole o script do AdSense nos dois blocos e **descomente as linhas indicadas
na Content-Security-Policy**. As páginas legais não têm anúncios.

> 📌 **Só submeta o site ao Google AdSense depois de ter tráfego orgânico real.** Contas
> novas com tráfego quase nulo são habitualmente recusadas por «conteúdo de baixo valor».

---

## ⚖️ Aviso legal

O Mente Fria é uma ferramenta de **estatística e análise desportiva**. Não é uma casa de
apostas, não processa apostas, não gere fundos de apostadores e não emite fichas ou
créditos de jogo. As tendências são informativas e **não constituem garantia de resultado**.
Conteúdo reservado a **maiores de 18 anos**. Actividade de jogo regulada em Angola pela
[Lei n.º 17/24, de 28 de Outubro](https://lex.ao/docs/assembleia-nacional/2024/lei-n-o-17-24-de-28-de-outubro/)
e supervisionada pelo [ISJ](https://isj.minfin.gov.ao/).

**Contactos:** goloaovivo@gmail.com · +244 922 514 198
