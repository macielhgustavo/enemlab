# v8.7 — Refining UI Edition

O centro de controle mantém grafite/petróleo, emerald/mint, Inter e a estrutura
de navegação. O acabamento desloca o peso de molduras para conteúdo.

## Princípios e antes/depois

| Antes | Agora |
|---|---|
| Métricas em cards dentro de outro card | Números tabulares sobre a própria página, com divisores |
| Home com frases, assinatura e curva decorativa | Saudação curta, próxima ação e desempenho real |
| Cartões idênticos em listas | Linhas contínuas no Banco, Histórico e Revisões |
| Verde em títulos, ícones e seleção | Ação principal e estados semânticos; seleção neutra |
| Texto pequeno em caixa alta por todo formulário | Labels legíveis, pesos moderados e tracking contido |
| Animação de entrada e contagem | Página e métricas imediatas; transições só em estado/overlay |
| Paleta solta sobre o documento | Dialog Radix, foco contido, retorno ao gatilho e seleção visível |
| Mobile com cinco atalhos incompletos | Início, Treinar, Banco, Revisões e Mais com todas as rotas |

## Telas

- **Home:** uma superfície para a ação, meta menor, métricas sem molduras,
  gráficos e atividade separados por linhas. No mobile, meta e semana lado a
  lado e indicadores em três colunas.
- **Banco:** filtros sem caixa externa, linhas compactas, seleção e metadados
  consistentes, alvos de toque ampliados.
- **Treinar:** campos consistentes, descrições dos modos sem cards internos.
- **Plano:** orçamento e resumo assimétricos no desktop, sinais e metadados
  sem caixas, sequência numerada com densidade de lista.
- **Domínio:** células sem brilho, dados tabulares e estados não testados
  legíveis, sem reduzir a opacidade de todo o conteúdo.
- **Revisões:** fila em linhas, ações de toque e estados vazios discretos.
- **Erros:** controles de classificação com estado anunciado, labels
  associados e campos com foco consistente.
- **Histórico:** linhas de sessões e agrupamentos naturais, números estáveis.
- **Resultado:** placar sem moldura redundante e contraste dos marcadores.
- **Review:** navegação lateral discreta, telemetria sem caixas e controles
  que se reorganizam no mobile.
- **Dados:** tabela em região rolável por teclado, layout sem corte horizontal,
  labels associados e indicadores de saúde com contraste.
- **Conta:** formulário principal e explicação de apoio com pesos distintos.

## Componentes e manutenção

Primitives continuam em `components/ui`, produto em `components/enem-lab`.
Button, Card, Badge, Select, Tabs, Progress, Tooltip, overlays e skeletons usam
os mesmos tokens. CVA centraliza apresentação de métricas, tonalidade dos ícones
e estado dos filtros. Não foi adicionada dependência.

`refinement.css` integra o acabamento nas telas legadas e é importado por último
no app e Storybook. Não substitui o contrato dos primitives: seus estilos foram
editados na origem. A separação permite continuar a migração do CSS legado.

`Brand.tsx` concentra nome, monograma e descrição atuais. Não há rebranding;
a marca da v9 poderá substituir esse contrato. Textos antigos de privacidade,
manifests e chaves de armazenamento não foram migrados para esse componente.

## Acessibilidade e movimento

Foco visível, link de salto, alvos de 44px no mobile, navegação completa via Sheet,
paleta via Dialog Radix, campos nomeados e contraste nos dois temas. Cor de texto
sobre a ação primária usa token próprio por tema. Não testado continua diferente
de zero, sem sacrificar a leitura do rótulo.

Números e gráficos aparecem imediatamente. O anel recebe o valor corrente.
Motion é mantido na entrada discreta da paleta, respeitando reduced motion.
Skeletons estáticos seguem a composição do conteúdo da Home.

## Verificação reproduzível

- `npm test`, `npm run lint`, `npm run build`, `npm run build-storybook`.
- `npm run test:e2e`: smoke, axe, snapshots e composição responsiva.
- Axe: 12 rotas × 2 temas × 2 projetos, além de testes de teclado.
- Composição: 12 rotas × 2 temas × 5 larguras (375, 425, 768, 1280, 1440).
  Os 120 PNGs de revisão ficam em `ui-review/`, ignorado pelo Git.
- Snapshots canônicos: Linux, seguindo `visual-testing.md`. A matriz local
  gera evidência para revisão; não sobrescreve baselines de outra plataforma.

Build estático e carregamento dinâmico de Recharts foram preservados. Retirar
contagem por frame, entrada de página, blur e decoração reduz trabalho visual;
isso não representa uma medição comparativa de Web Vitals. Não há alegação de
ganho percentual de performance.

O relatório da PR registra os resultados efetivos dos comandos e limitações
observadas, incluindo as verificações executadas no CI.
