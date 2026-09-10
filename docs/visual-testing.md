# Testes visuais

## O que cada suíte faz

| Comando | Cobre | Falha quando |
|---|---|---|
| `npm run test:e2e` | tudo abaixo | qualquer um falha |
| `npm run test:e2e:ci` | fumaça + a11y | rota quebrada, erro de cliente, violação séria de a11y |
| `npm run test:a11y` | axe em 4 telas, 2 temas | contraste, nome acessível, papel, foco |
| `npm run test:visual` | 10 capturas por viewport | layout, cor ou componente mudou |

Dois viewports em todos: desktop 1440×900 e mobile 390×844.

## O que a regressão visual não faz

Ela diz **"nada mudou desde a última vez que alguém olhou"**. Não diz que a
tela ficou boa. Aprovar uma captura sem olhar o diff transforma a suíte em
decoração cara.

## Ambiente

As capturas de referência são geradas **no Linux**, pelo mesmo runner que as
cobra. Isso não é preciosismo: fonte e antialiasing diferem o bastante entre
Windows e Linux para reprovar todas as telas ao mesmo tempo.

Por isso **não existe** sufixo de plataforma no nome do arquivo. Há uma
referência por tela e por viewport:

```
e2e/__screenshots__/desktop/home-dark.png
e2e/__screenshots__/mobile/home-dark.png
```

Navegador: canal `chrome`, o mesmo no CI e no desenvolvimento. O Chromium
empacotado do Playwright não baixa em todo ambiente, e um navegador
diferente renderiza texto diferente.

## Rodar localmente

```bash
npm run test:visual
```

No Windows ou no macOS **as diferenças serão grandes** — a referência é
Linux. Localmente a suíte serve para ver se a tela ainda abre e monta; o
veredito é o do CI.

## Atualizar a referência

Toda vez que uma mudança visual é intencional:

1. Abra o PR com a mudança. O job `visual` do CI vai reprovar — é o esperado.
2. Baixe o artefato `diferencas-visuais` e **olhe o diff**. O relatório traz
   esperado, obtido e diferença lado a lado.
3. Se a mudança é a que você queria, rode o workflow **Capturas de
   referência (Linux)** pelo Actions, informando o motivo.
4. Baixe o artefato `capturas-linux` e substitua `e2e/__screenshots__/`.
5. Commite as capturas junto com a mudança que as causou.

```bash
gh workflow run visual-baselines.yml -f motivo="novo cabeçalho do Banco"
gh run download <id> -n capturas-linux -D e2e/__screenshots__
```

O workflow **não** escreve no repositório de propósito. Bot que atualiza
referência sozinho aprova a própria regressão.

## Como não criar teste instável

Cada item abaixo já causou uma falha aqui:

| Fonte de instabilidade | Como é tratada |
|---|---|
| Data e saudação por hora do dia | `page.clock.setFixedTime(INSTANTE_FIXO)` |
| Rede externa | `interceptarApi` responde pela API do ENEM com lote fixo |
| Dados do usuário | `prepare()` semeia `localStorage` antes de qualquer script |
| Animação em curso | CSS zera duração, atraso e repetição |
| Fonte ainda carregando | `await document.fonts.ready` antes de medir |
| Barra de rolagem | escondida: a largura difere entre sistemas |
| `networkidle` | **não use.** Estourou de forma intermitente; espere conteúdo |
| Cursor piscando | `caret-color: transparent` |

## Tolerância

O padrão é 1,2% dos pixels (`maxDiffPixelRatio`, em `playwright.config.ts`),
larga o bastante para sobreviver a sub-pixel entre máquinas.

Ela é uma **fração do total**, então numa página longa 1,2% é bastante espaço
para uma mudança real se esconder — já aconteceu: uma correção de espaçamento
no Resultado não fez a captura falhar.

Por isso algumas telas apertam a régua em `e2e/visual.spec.ts`:

| Tela | Tolerância | Por quê |
|---|---|---|
| Banco | 0,5% | lista repetitiva: mudança de layout aparece em todas as linhas |
| Histórico, Revisões, Domínio | 0,6% | curtas e densas em texto |
| Home, Resultado, Plano | 1,2% | longas, o ruído acumula mais |

Apertar demais troca uma cegueira por outra: alarme falso semanal também
ensina a ignorar o vermelho.

## Quando uma captura falha

Antes de regenerar, responda: **a mudança era intencional?**

- Sim → siga "Atualizar a referência".
- Não → é uma regressão. Corrija o código, não a captura.
- Não sei → o diff mostra. Abra o relatório.

## Job do CI

`visual` é um job separado de `validate`. Diferença de pixel falha por
motivos diferentes de teste unitário, e no mesmo log um esconde o outro.
