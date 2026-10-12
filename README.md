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
├── privacidade.html         → Política de Privacidade
├── termos.html              → Termos de Uso
├── jogo-responsavel.html    → Jogo Responsável
├── assets/
│   ├── style.css            → CSS partilhado pelas 4 páginas
│   ├── favicon.svg          → favicon (floco de neve ciano na aba do navegador)
│   └── og-image.png         → imagem estática 1200×630 para og:image/twitter:image
├── tools/
│   └── gerar-og-image.js    → script que (re)gera o og-image.png (só para manutenção)
├── vercel.json              → configuração de deploy/cabeçalhos na Vercel
├── .vercelignore            → impede o deploy de _arquivo/, tools/ e README.md
├── robots.txt               → indexação
├── sitemap.xml              → sitemap das 4 páginas
├── README.md                → este guia
└── _arquivo/                → versão anterior (backup, não publicada)
```

---

## 🔌 Fonte de dados

**ESPN** — API pública, **sem chave** e com CORS aberto (`site.api.espn.com`):

| Uso | Endpoint |
|---|---|
| Jogos do dia | `/apis/site/v2/sports/{desporto}/scoreboard?dates=AAAAMMDD` |
| Últimos jogos de uma equipa | `/apis/site/v2/sports/{desporto}/teams/{id}/schedule` |

Competições consultadas (editáveis em `COMPETICOES`, no `index.html`):
Premier League (`soccer/eng.1`), La Liga (`soccer/esp.1`), Champions League
(`soccer/uefa.champions`), CAF Champions League (`soccer/caf.champions`) e NBA
(`basketball/nba`).

> **Nota sobre o Girabola:** a fonte pública da ESPN não publica a liga angolana, pelo que
> o Girabola não aparece na lista. Se a ESPN passar a disponibilizar o código da liga,
> basta acrescentar uma linha em `COMPETICOES.futebol`.
>
> **Nota histórica:** a versão inicial deste projecto usava a TheSportsDB com a chave de
> teste `123`. Essa chave devolve no máximo **1 resultado** em `eventslast.php` (o que torna
> impossível calcular a média dos últimos 5 jogos) e responde **HTTP 429** ao fim de poucos
> pedidos — por isso foi substituída pela ESPN.

---

## ⚙️ Onde editar (tudo no topo do `index.html`)

```js
// Links de afiliado (acrescente novas casas de apostas aqui — o resto do código não muda)
const AFFILIATE_LINKS = {
  bantubet: "https://bantubet.co.ao/affiliates/?btag=2532299"
};

// Domínio público do site (usado nas mensagens de partilha)
const SITE_URL = "https://goloaovivo.ao";

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

`desporto_escolhido`, `jogo_escolhido`, `card_gerado`, `clique_cta_apostar`,
`partilha_whatsapp` (com o modo: `nativo_com_imagem` ou `descarga_mais_wa_me`),
`partilha_whatsapp_cancelada`, `partilha_whatsapp_erro` e `clique_rodape_legal`.

Ao fim de 1–2 semanas, estes dados dizem **qual desporto/liga gera mais cliques de afiliado
por card gerado** — informação para decidir onde investir mais tempo.

---

## 🧮 Como as estatísticas são calculadas

1. Jogos do dia vindos do `scoreboard` da ESPN para a data escolhida;
2. Para cada equipa do jogo, busca-se o histórico recente (`teams/{id}/schedule`); se não
   houver jogos suficientes (habitual na NBA fora de época), tenta-se a época anterior com
   `?season=AAAA`;
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

Todos os pedidos usam `AbortController` com **timeout de 8s** e cache em memória, e o
utilizador nunca fica com o ecrã bloqueado por causa de uma equipa sem dados.

---

## 📲 Partilha (o motor viral)

- **Telemóvel (Web Share API):** gera a imagem do card no `<canvas>` (1080×1350), converte
  em ficheiro PNG e abre o **menu nativo de partilha** com a imagem já anexada.
- **Desktop / navegador sem suporte:** descarrega a imagem automaticamente e abre o
  `wa.me` com o texto da análise, para anexar a imagem à mão (aberto por clique em
  âncora, para não ser bloqueado como *pop-up*).

O aviso `📊 Estatística baseada nos últimos 5 jogos. Tendência, não garantia.` está sempre
presente **dentro do card e dentro da imagem partilhada**.

---

## ✅ Conformidade com a Vercel

Este projecto é um **site estático puro** (HTML + CSS + JS, sem build). Para este tipo de
projecto a Vercel **só exige o `index.html` na raiz** — não é preciso `package.json`,
comando de build nem pasta `dist`.

| Ficheiro | Papel | Vercel |
|---|---|---|
| `index.html` | porta de entrada do site | **obrigatório** |
| `termos.html`, `privacidade.html`, `jogo-responsavel.html` | páginas adicionais | opcional |
| `assets/style.css`, `assets/favicon.svg` | CSS e ícone | opcional |
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
  (selo «Publicidade» no CTA) — tudo já implementado nas 4 páginas;
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

Antes de publicar, substitua `https://goloaovivo.ao` em `SITE_URL`, no `robots.txt`, no
`sitemap.xml`, nas meta tags Open Graph (incluindo `og:image`/`twitter:image`) e no
`tools/gerar-og-image.js` pelo domínio real.

---

## 🖼️ Imagem de partilha do link (og:image)

O link do site partilhado no WhatsApp/Telegram/facebook usa `assets/og-image.png`
(1200×630, gerada com o mesmo tema do site). Está referenciada em `og:image` e
`twitter:image` nas 4 páginas — **sem esta imagem, o `twitter:card=summary_large_image`
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
