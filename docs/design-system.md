# ENEM Lab — Design System v1

Este documento existe para a próxima tela não ser inventada do zero.

## 1. Filosofia

**80% produto educacional premium, 20% mission control técnico.**

O aluno passa horas aqui, muitas vezes cansado, muitas vezes de madrugada.
A interface tem que ser calma e legível primeiro; a estética técnica é
tempero, não prato principal.

Na prática:

- **Grafite e petróleo** sustentam a tela. Verde é evento, não fundo.
- **Hierarquia por tamanho, peso e espaço**, não por cor e brilho.
- **Números são o produto.** Nada compete com um número.

### Quando usar glow

Brilho é sinal. Só nestes quatro casos:

1. a ação principal da tela (um botão `primary`);
2. o estado ativo de um seletor;
3. o destaque de progresso quando ele é a informação central;
4. um alerta que exige ação.

### Quando não usar

Em qualquer outro lugar. Card comum, badge, borda, texto secundário, ícone
decorativo e hover não brilham. Se tudo brilha, nada chama.

O que ficou fora de propósito: gradiente em card, sombra colorida, borda
animada, néon em texto.

## 2. Tokens

`src/styles/tokens.css`. Um token diz o **papel**, não a aparência.

| Grupo | Tokens |
|---|---|
| Superfície | `--bg-canvas` `--bg-subtle` `--bg-surface` `--bg-raised` `--bg-overlay` |
| Texto | `--text-primary` `--text-secondary` `--text-muted` `--text-faint` |
| Borda | `--border-subtle` `--border-default` `--border-strong` `--border-active` |
| Acento | `--accent-primary` `--accent-info` `--accent-violet` |
| Estado | `--success` `--warning` `--danger` `--info` |
| Espaço | `--space-4` `8` `12` `16` `24` `32` `48` `64` |
| Raio | `--radius-sm` `md` `lg` `xl` |
| Elevação | `--shadow-sm` `md` `lg` `--shadow-focus` |
| Movimento | `--motion-fast` `normal` `slow`, `--easing-standard`, `--easing-emphasized` |

A maioria é **alias** dos tokens originais do mission control (`--brand`,
`--panel`, `--line`). Isso é deliberado: as 3287 linhas de CSS existentes
continuam válidas, e a migração é progressiva. Código novo usa só o nome
semântico; com o tempo os valores brutos sobem para cá.

**Escala fechada.** Se você precisa de 13px de espaçamento, o problema é
outro. Use 12 ou 16.

## 3. Tipografia

`src/styles/typography.css`. Semântica e aparência são coisas diferentes.

`display` · `heading-xl` · `heading-lg` · `heading-md` · `heading-sm` ·
`body` · `body-sm` · `label` · `caption` · `telemetry` · `mono`

`h1` valia 68px em qualquer lugar, então as telas escolhiam a tag pela
aparência e a estrutura do documento ia junto. Agora:

```tsx
// A tag diz a estrutura. A classe diz o tamanho.
<h1 className="heading-md">Sessão de hoje</h1>
```

`telemetry` usa numeral tabular: número que o usuário compara com outro
número não pode mudar de largura enquanto anima.

## 4. Componentes

```
src/components/ui/          primitives (Radix + nosso CSS)
src/components/enem-lab/    componentes de produto
src/styles/components.css   identidade dos primitives  (prefixo el-)
src/styles/enem-lab.css     identidade dos de produto
```

### Por que não shadcn completo

O shadcn foi investigado antes de qualquer instalação. O `button` dele hoje
depende de `radix-ui` + `cn` e é estilizado inteiramente por utilitário do
Tailwind sobre tokens próprios (`ring`, `destructive`, `border-ring`).

Este app não estiliza por utilitário. Rodar o CLI do shadcn injetaria um
segundo vocabulário de tokens no `globals.css` — duas fontes de verdade para
a mesma cor.

Então adotamos a **parte estrutural** e recusamos a de estilo: `radix-ui` (o
mesmo primitive que o shadcn usa) e `class-variance-authority` (a mesma API
de variantes), com a identidade escrita por nós. O que o shadcn entrega de
realmente difícil — foco preso, Esc, roving tabindex, `aria-*` correto — vem
do Radix de qualquer jeito.

Base UI foi descartado por estar em `1.0.0-rc.0`. Fundação não se apoia em RC.

### Button

`variant`: `primary` `secondary` `outline` `ghost` `danger`
`size`: `sm` `md` `lg` `icon`
`loading` bloqueia o clique, mantém a largura e marca `aria-busy`.

Uma tela tem **um** `primary`. Se tiver dois, um deles não é a ação principal.

### Card

`variant`: `default` `raised` `subtle` `interactive` `danger` `success`

`interactive` sobe **1px** no hover. Mais que isso faz a página tremer numa
grade de cartões, e é revertido sob `prefers-reduced-motion`.

### Layout

`PageShell` `PageHeader` `Section` `Stack` `Cluster` `Grid`

Existem para tirar `style={{ display: "flex", gap: 12 }}` das telas. `Grid`
se adapta sozinho por `auto-fit`: não escreva media query por página.

### MetricCard

O componente com a regra mais importante do sistema:

```tsx
// Sem amostra NÃO é zero.
<MetricCard label="Taxa de acerto" value={null} hint="Corrija um treino" />
<MetricCard label="Taxa de acerto" value={0} />  // zero de verdade: 0 de 20
```

Um painel que mostra "0%" para quem nunca respondeu nada está afirmando que
a pessoa errou tudo. Passe `null` quando não há amostra.

## 5. Movimento

| Uso | Duração |
|---|---|
| Microinteração (hover, foco) | `--motion-fast` (140ms) |
| Transição padrão | `--motion-normal` (220ms) |
| Modal, drawer | `--motion-slow` (320ms) |

Nada anima só porque dá. Animação serve para explicar de onde uma coisa veio
ou para onde foi.

`prefers-reduced-motion` zera as durações **no próprio token**, então
componente novo não consegue escapar disso por esquecimento.

Contagem de número é efeito de **entrada**: trocar de prova troca o número na
hora, sem reanimar. Atrasar o enfeite é aceitável; exibir o dado da prova
anterior, não.

## 6. Dark e light

Escuro é o principal. O claro **não é o escuro invertido**: a hierarquia se
inverte de verdade — no escuro a superfície sobe clareando, no claro o fundo
é acinzentado e o cartão é branco puro.

Cuidado que já custou caro: o claro tinha herdado a escala de cinzas do
escuro sem refazer a conta de contraste, e `--text-faint` ficava em 2,5:1
contra os 4,5 exigidos, reprovando 22 elementos da Home.

**Toda cor de texto nova precisa da conta feita nos dois temas.**

## 7. Acessibilidade

Obrigatório em componente novo:

- foco visível (`--shadow-focus`, nunca `outline: none` sozinho);
- contraste AA (4,5:1 para texto) nos **dois** temas;
- operável só pelo teclado, incluindo sair de onde entrou;
- nome acessível em todo controle (`<label htmlFor>`, `aria-label`);
- `aria-expanded`, `aria-selected`, `aria-checked` onde houver estado;
- `role` correto — `aria-label` em `<div>` sem papel é atributo proibido.

Automatizado: o addon `a11y` roda o axe em cada story (modo erro), e
`e2e/a11y.spec.ts` roda o axe em quatro telas nos dois temas.

O que a automação **não** pega: se a tela faz sentido navegando de teclado.
Isso continua sendo conferência humana.

## 8. Responsividade

| Faixa | Largura |
|---|---|
| wide | ≥ 1440 |
| desktop | 1024–1439 |
| tablet | 768–1023 |
| mobile | < 768 |

Adaptar não é esconder. Cartão, comando, seletor de prova, grade de métricas
e diálogo mudam de forma; a informação não some.

## 9. Como criar um componente novo

1. Precisa mesmo? Procure em `ui/` e `enem-lab/` antes.
2. É estrutural (menu, diálogo, aba)? Comece pelo primitive do Radix.
3. Estilo em `components.css` ou `enem-lab.css`, prefixo `el-`, só tokens.
4. Variantes com `cva`, não com `if` no `className`.
5. Story com dark, light e os estados de vazio/carregando/erro que existirem.
6. Rode `npm run lint` e o Storybook: o axe reprova ali antes do PR.

## 10. Checklist de PR visual

- [ ] usa token (sem cor literal fora de `tokens.css`)?
- [ ] existe nos dois temas, com contraste conferido?
- [ ] operável só pelo teclado?
- [ ] foco visível?
- [ ] funciona em 390px?
- [ ] tem estado de carregando?
- [ ] tem estado de vazio — e o vazio oferece um caminho?
- [ ] tem estado de erro?
- [ ] respeita `prefers-reduced-motion`?
- [ ] não duplica componente que já existe?
- [ ] story criada ou atualizada?
- [ ] captura de regressão visual conferida **a olho** antes de aprovar?

## 11. Comandos

```bash
npm run storybook          # catálogo em 6006
npm run build-storybook    # build estático
npm run test:e2e           # tudo, inclusive regressão visual
npm run test:e2e:ci        # fumaça + a11y (job `validate` do CI)
npm run test:a11y          # só o axe
npm run test:visual        # só a regressão visual (job `visual` do CI)
```

## 12. Densidade

Três níveis. Não são preferência do usuário: são decisão de projeto sobre
quanto ar cada tela merece.

Até a v1.1 isto era só convenção escrita aqui — e convenção não roda
sozinha. Agora é um atributo que redefine dois tokens:

```
[data-density="compact"]   --density-gap: 8px   --density-pad: 16px
[data-density="default"]   --density-gap: 16px  --density-pad: 24px
[data-density="spacious"]  --density-gap: 24px  --density-pad: 32px
```

O shell escolhe pela rota (`densidadeDaRota`), e `PageShell` aceita
`density` para casos pontuais. `Card`, `Stack` e as listas leem os dois
tokens, então componente novo herda sem precisar saber que isto existe.

| Nível | Onde | Por quê |
|---|---|---|
| `compact` | Banco, Revisões | centenas de linhas: cada pixel de respiro custa uma linha a menos |
| `default` | o resto | |
| `spacious` | Home | poucos blocos, muito peso em cada um |

## 13. Padrões de tela

### Filtros

`FilterBar` + `FilterGroup` + `FilterChip`.

Escolha curta (até ~6 opções) é **chip**, à vista. Um `<select>` esconde as
opções até você abrir: com cinco selects em fila, era preciso abrir os cinco
para saber o que dava para filtrar. `<select>` fica para lista longa —
edição da prova tem quinze anos e viraria uma parede de chips.

No celular tudo vai para um painel de baixo: filtro em fila espreme o
conteúdo que o usuário veio ver.

### Listas

`HistoryItem` é o modelo: identidade à esquerda, número no meio, metadados
depois, ação à direita, e uma faixa de cor na lateral para varrer a coluna
sem ler número.

Tabela só quando o usuário compara valores em coluna. Seis colunas com um
único campo numérico viram rolagem horizontal no celular sem ganhar nada.

### Resultado

Ordem fixa: **resultado → diagnóstico → próxima ação.**

`ResultSummary` faz o placar ser o assunto. Quatro cartões de mesmo peso
fazem "tempo médio" competir com o número que a pessoa veio ver.

A ressalva sobre o número muda com a banca. O ENEM tem TRI e o placar não é
ela; o ITA não tem TRI nenhuma, então citá-la ali inventa um conceito que a
prova não usa.

### Gráficos

`ChartContainer` · `ChartTooltip` · `ChartLegend` · `ChartEmpty` ·
`chartTheme` · `CHART_COLORS`.

Recharts continua. O que os wrappers garantem é que grade, eixo, tooltip e
cor saem de um lugar só — antes havia uma tabela de hex duplicando os
tokens, e o eixo do tema claro ainda usava um valor de contraste que já
tinha sido corrigido.

`ChartContainer` exige `label` (SVG sem descrição é um buraco para quem não
vê a tela) e altura explícita (o `ResponsiveContainer` colapsa para zero em
silêncio quando o pai não tem uma).

Gráfico sem dado usa `ChartEmpty`, nunca uma curva reta no chão: uma linha
em zero afirma que o desempenho foi zero, quando o que houve foi ausência
de medição.

## 14. Cores literais

Hex, `rgb()` e `hsl()` são **proibidos** em `components/ui`,
`components/enem-lab`, `styles/components.css` e `styles/enem-lab.css`.

Reprovado por `src/lib/design/no-raw-colors.test.ts`. Exceções vivem numa
lista no próprio teste, cada uma com o motivo escrito, e um segundo teste
falha se a lista crescer sem explicação.

`tokens.css` fica fora: é o único lugar onde um literal é a resposta certa.

### A fatia do legado

O legado inteiro tem centenas de literais, e travá-lo de uma vez produziria
uma lista que ninguém zera. Em vez disso há uma **fatia vigiada** que só
cresce: `LEGADO_SOB_REGRA` lista as classes de `globals.css` já migradas
(`rail`, `railnav`, `railgroup`, `mobilebar`, `cmdk`), e as regras delas
valem a mesma proibição. Ao migrar um bloco, acrescente a classe à lista.

Há um teste que confere que o scanner **encontra regras**. Ele existe por um
motivo concreto: a primeira versão montava o regex num template literal, onde
a sequência barra-b vira o caractere backspace em vez da borda de palavra —
o scanner varria zero linhas e o teste passava sem olhar nada. Teste que
passa por não encontrar nada é pior que teste nenhum.

## 15. Regressão visual

Ver [visual-testing.md](visual-testing.md).

O resumo: as capturas de referência são geradas **no Linux**, pelo mesmo
runner que as cobra, pelo workflow **Capturas de referência (Linux)**.
Copiar PNG do Windows não funciona — fonte e antialiasing diferem o
bastante para reprovar tudo.

## 16. Estado da migração

| Tela | Estado |
|---|---|
| Home | migrada (v1.0) |
| Plano | migrada |
| Banco | migrada |
| Histórico | migrada |
| Resultado | migrado |
| Conta | migrada |
| Treinar | migrado |
| Dados | cabeçalho migrado |
| Revisões | migrada |
| Erros | migrada |
| Domínio | cabeçalho e estados migrados |
| Review pós-prova | cabeçalho, filtros e paginação migrados |
| Adaptive | CSS legado |
| Exam Runner | preservado por decisão de escopo |

CSS: **3208 linhas** legadas contra **1624** do design system. Foram
removidas 110 linhas de regras que ficaram sem nenhum uso após a migração
(`bankFilters`, `bankList`, `bankItem`, `scoreline`, `statrow`,
`rail-sign`), conferidas uma a uma contra o código.

## 17. Limites conhecidos

- **O Chromium empacotado do Playwright não baixa em todo ambiente.** A
  config usa `channel: "chrome"`. Se o download voltar, tirar o channel é
  uma linha.
- **A migração é parcial** e a tabela acima diz onde. Os dois sistemas
  convivem de propósito: `el-` não colide com os nomes curtos antigos.
- **O Exam Runner e o Review pós-prova não foram redesenhados**, por decisão
  de escopo.
- **Rodar a regressão visual no Windows ou no macOS mostra diferenças
  grandes** — a referência é Linux. Localmente ela serve para ver se a tela
  monta; o veredito é o do CI.
