# EDH Builder — Análise Estatística de Deck

App web (React + TypeScript, 100% client-side) que recebe uma lista de deck de
Magic: The Gathering e calcula a **consistência matemática** do baralho:
probabilidade de "estar on curve" com terrenos, probabilidade de ter fontes de
cor suficientes por turno, e probabilidade de montar um combo específico
considerando tutores.

Os dados de cada carta (tipo, custo de mana, oracle text, cores, mana
produzida) vêm da [API pública do Scryfall](https://scryfall.com/docs/api),
consultada diretamente do navegador (o Scryfall libera CORS para isso — não há
backend). Nenhuma lista de deck é enviada a nenhum servidor além das consultas
públicas ao Scryfall.

## Como rodar

```bash
npm install
npm run dev       # ambiente de desenvolvimento
npm run build     # build de produção (dist/)
npm run test      # testes do motor matemático (vitest)
```

## O que o app calcula, e por quê

### 0. Busca de cartas com fallback aproximado (`src/lib/scryfall.ts`)

A busca em lote (`/cards/collection`) exige nome exato, o que falha em dois
casos comuns: nomes alternativos ("flavor name", usados em Secret Lair /
Universes Beyond) e listas que trazem só o nome da face da frente de uma
carta de duas faces (ex.: "Delver of Secrets" em vez de "Delver of Secrets //
Insectile Aberration"). Para qualquer nome que não bate exato, o app tenta de
novo, um a um, via busca aproximada (`/cards/named?fuzzy=`) — o mesmo
endpoint tolerante a variação que o próprio Scryfall usa. Cartas resolvidas
assim aparecem destacadas na tela para o usuário conferir.

### 1. Classificação das cartas (`src/lib/classify.ts`)

Cada carta buscada no Scryfall é classificada por **heurísticas sobre o oracle
text** (regex sobre o texto oficial da carta, não uma IA): terreno/fonte de
mana (usa o campo `produced_mana` do Scryfall, com fallback para terrenos
básicos), rampa, tutor (e se busca "qualquer carta" ou algo restrito, e se a
carta buscada vai para a mão ou para o topo do baralho), compra de cartas e
remoção/interação. Isso é transparente e auditável — cada carta processada
aparece na tabela final com suas tags, para o usuário corrigir manualmente
casos que a heurística erre (linguagem de Magic tem muitas exceções).

Como enriquecimento **opcional** (função exportada, não usada por padrão no
fluxo principal para não depender de disponibilidade de rede além do
essencial), `fetchNamesWithOracleTag` em `src/lib/scryfall.ts` consulta as
["oracle tags"](https://scryfall.com/docs/api/tags) mantidas pela comunidade
via o operador de busca `otag:` do próprio Scryfall
([lista de tags](https://scryfall.com/docs/tagger-tags)).

### 2. Motor de probabilidade exato (`src/lib/probability.ts`)

Usa a **distribuição hipergeométrica** (compras sem reposição), a mesma base
matemática usada por [Frank Karsten em seus artigos sobre quantas fontes de
mana são necessárias por turno](https://www.channelfireball.com/) e por
calculadoras públicas de MTG (Draftsim, AetherHub, Deck-u-lator). O código
inclui:

- `hypergeomPMF` / `hypergeomAtLeast`: probabilidade exata de ver `k` ou mais
  sucessos entre `n` cartas vistas de um baralho de `N` cartas com `K`
  sucessos.
- `cardsSeenByTurn`: quantas cartas foram vistas (mão + compras) até um turno,
  considerando se o jogador começa jogando ou comprando.
- `landDropProbability` / `colorSourceProbability`: aplicações diretas para
  "terrenos on curve" e "fontes de cor suficientes por turno" (modelo de
  Karsten).
- `probabilityAllGroupsCovered`: cobertura exata de **múltiplos grupos
  disjuntos** de cartas via inclusão-exclusão (ex.: "preciso de pelo menos 1
  terreno de cor E pelo menos 1 artefato de rampa").
- `karstenLandBandForCommander`: uma faixa de referência (não uma fórmula
  garantida) para quantidade de terrenos em Commander, baseada nas faixas por
  CMV médio divulgadas publicamente por Karsten a partir de simulações Monte
  Carlo — sempre exibida junto dos números exatos calculados para o deck
  específico do usuário.

Todas as fórmulas têm testes unitários que as validam contra uma
implementação de referência independente (combinatória exata em `BigInt`) e,
para os casos de múltiplos grupos, contra enumeração por força bruta — veja
`src/lib/__tests__/probability.test.ts`.

### 3. Por que tutores exigem simulação, não só uma fórmula (`src/lib/simulation.ts`)

A hipergeométrica fechada é exata para "pelo menos 1 sucesso de um grupo". Mas
um tutor que "busca qualquer carta" só pode resolver **uma** peça em falta por
vez — ele não pode ser somado como +1 sucesso em cada peça do combo
simultaneamente, e ainda depende de ter mana disponível no turno em que é
comprado. Isso quebra a exatidão de uma fórmula fechada simples quando o combo
tem 2+ peças e tutores "wildcard".

Por isso o app roda uma **simulação Monte Carlo**: embaralha o baralho,
simula compras turno a turno (respeitando jogar primeiro/depois), joga um
terreno por turno quando disponível, e conjura um tutor da mão quando há mana
suficiente e ainda falta alguma peça do combo — decidindo o alvo entre as
peças ainda não encontradas. Isso é a mesma abordagem usada por calculadoras
de consistência publicadas (e pelas próprias simulações de mana base de
Karsten, feitas sobre milhões de partidas amostradas).

Terrenos também podem ser peça do combo (ex.: Dark Depths + Thespian's
Stage): um slot marcado como "só terreno" conta como a jogada de terreno do
turno quando é comprado, e o terreno "de preenchimento" do resto do baralho é
calculado descontando essas cópias, para não contar a mesma carta duas vezes.

Compra de cartas também acelera achar o combo, além dos tutores — a simulação
modela isso com duas categorias: **compra única** (ex.: Harmonize — resolve
uma vez e se esgota) e **motor recorrente** (ex.: Rhystic Study, Phyrexian
Arena, Sylvan Library — uma vez em campo, compra de novo a cada turno
seguinte sem precisar ser conjurada outra vez). `classify.ts` detecta essas
cartas e pré-preenche quantas cartas cada uma compra e se é provavelmente um
motor (gatilho de upkeep/passo de compra, ou "sempre que um oponente
conjura"), mas o usuário pode corrigir. Em cada turno, a mana disponível é
gasta primeiro em tutor (ação certeira — acha a peça que falta na hora) e só
o que sobra vai para compra (cava mais fundo, mas sem garantia de achar a
peça) — gastar em compra primeiro faria a compra "morrer de fome" o tutor
toda vez que os dois competem pela mesma mana. É uma ordem simples e
documentada, não uma escolha "ótima" carta a carta. Simplificação assumida:
o gatilho de compra sempre resolve (não
modela o oponente pagando para negar Rhystic Study/Mystic Remora, nem o
"put back" de Sylvan Library).

Os testes em `src/lib/__tests__/simulation.test.ts` verificam que a simulação
converge para o valor hipergeométrico exato quando não há tutores, que um
tutor dedicado aumenta a probabilidade do combo, e que um tutor wildcard não
"resolve" duas peças ao mesmo tempo.

### 4. Importar direto de um link (`src/lib/deckImport.ts`)

Além de colar a lista, dá para colar o link público de um deck do
**Moxfield** (`moxfield.com/decks/...`) ou do **Archidekt**
(`archidekt.com/decks/...`). Nenhum dos dois tem API oficial para terceiros,
mas ambos expõem — no próprio domínio, sem autenticação — o endpoint JSON que
o site usa para renderizar a página do deck; o app busca exatamente esse
endpoint direto do navegador (sem raspar HTML, sem proxy de terceiros). Isso
pode falhar por CORS, principalmente no Moxfield (protegido por
anti-bot/Cloudflare) — quando falha, a mensagem de erro orienta a exportar a
lista como texto por lá e colar na aba "Colar lista".

### 5. Eficiência e consistência geral (`src/lib/mulligan.ts`, `src/lib/goldfish.ts`)

Além dos combos, o app tem uma seção "Eficiência e consistência do deck" com
métricas mais gerais:

- **Mana flood x mana screw**: extensão direta da hipergeométrica exata —
  `screw` é a probabilidade de ter perdido a curva de terrenos (inverso da
  seção de consistência de mana); `flood` é a probabilidade de já ter
  comprado 3+ terrenos além do que o turno pede.
- **Qualidade da mão inicial (mulligan)**: simulação Monte Carlo da regra de
  Londres (compra 7, mantém se os terrenos caírem numa faixa configurável,
  senão compra de novo até 3 vezes, descendo cartas ao manter). Não existe
  fórmula fechada simples aqui porque a decisão de manter depende de uma
  faixa (não um valor único) e o "bottom" pós-mulligan é uma escolha do
  jogador — por isso é simulado, com a simplificação (documentada no código)
  de que o bottom prioriza aproximar a mão da faixa aceitável.
- **Simulação "goldfish"**: Monte Carlo jogando sozinho (compra, desce
  terreno, conjura o feitiço mais caro que couber, 1 por turno) para medir a
  chance de ter alguma jogada legal em cada turno e a mana média
  desperdiçada — um proxy de eficiência da curva completa, que a
  hipergeométrica isolada não captura porque depende da curva inteira, não
  de um único grupo de cartas.
- **Score de consistência (0–100)**: heurística de apoio que combina, com
  pesos declarados na própria tela, terrenos dentro da faixa de Karsten,
  fontes de cor no turno 3 e densidade de rampa/compra/remoção. É só um
  resumo — as probabilidades exatas em cada seção continuam sendo a fonte de
  verdade.

### 6. Objetivos do deck / plano de jogo (`src/lib/goalPlan.ts`)

Em vez de estatísticas genéricas, essa seção deixa o usuário descrever o que
o deck **quer fazer** — ex.: "turno 1, conjurar o Comandante" + "turno 2, ter
4 terrenos em jogo", ou "até o turno 4, ter conjurado uma carta de rampa pelo
menos 2 vezes". Cada meta é uma de quatro formas: terrenos em jogo, fontes de
uma cor, conjurar uma carta/o Comandante num turno, ou conjurar uma
carta/categoria N vezes até um turno.

O ponto importante: todas as metas de um plano são avaliadas **juntas, na
mesma partida simulada** (Monte Carlo), não como probabilidades
independentes multiplicadas — porque a mana gasta numa meta afeta a chance
de bater a próxima (o próprio exemplo "comandante turno 1 E 4 manas turno 2"
só faz sentido calculado em conjunto: se sobrar mana do comandante, ela
ajuda o turno seguinte). O resultado mostra a probabilidade do plano
completo e a probabilidade marginal de cada meta individual, para achar qual
delas está travando o plano.

O comandante é tratado como sempre disponível (zona de comando, não precisa
ser comprado) — a meta "conjurar o Comandante" checa só se há mana e cores
suficientes, não a chance de tê-lo na mão. Simplificação assumida (a mesma
já usada na seção de fontes de cor): pagar um custo colorido é aproximado
por "terrenos em jogo ≥ custo total" E "fontes daquela cor ≥ pips daquela
cor" checados separadamente, sem resolver que um terreno dual só paga 1 pip
por vez.

## Usando o app

1. Cole a lista do deck (formatos `1 Nome`, `1x Nome` ou apenas `Nome` por
   linha; uma seção/linha "Commander" marca o(s) comandante(s), que saem da
   biblioteca para o cálculo de probabilidades) — ou use a aba "Importar
   link" para trazer automaticamente de um deck público do Moxfield/Archidekt.
2. Escolha o formato/tamanho do baralho, se joga primeiro e quantos turnos
   analisar.
3. Depois de analisado: veja a curva de mana, a chance de estar "on curve"
   com terrenos, a chance de ter fontes de cor suficientes por turno/cor
   (ajustável), monte os "slots" do seu combo (com redundâncias) e marque
   quais tutores/cartas de compra buscam/cavam quais slots, e monte um plano
   de jogo com metas por turno (ex.: comandante no turno 1) na seção
   "Objetivos do deck".

## Limitações conhecidas (por design)

- A classificação de cartas é heurística (regex sobre oracle text); casos
  incomuns podem precisar de correção manual — a tabela de cartas mostra as
  tags aplicadas a cada carta.
- A simulação assume mulligan zero e no máximo 1 tutor conjurado por turno
  (aproximação conservadora, ajustável no código).
- A recomendação de "quantidade de terrenos" é uma heurística de referência
  pública, não uma garantia — as probabilidades exatas calculadas para o seu
  deck são a fonte de verdade.
