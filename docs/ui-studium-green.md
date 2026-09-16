# Studium Labs — Ultimate Green Edition

A interface trata estudo como trabalho intelectual cotidiano: uma decisão clara,
evidências legíveis e caminhos secundários que não competem com a próxima ação.
O verde identifica ação e estado positivo; títulos, números, linhas e espaço
organizam o restante. O produto continua técnico e denso, sem brilho decorativo.

## Hierarquia visual

- Home: a próxima sessão ocupa o único painel de destaque. Prontidão é um
  número, o ciclo é uma faixa de dados e as seções analíticas são agrupadas por
  linhas e alinhamento.
- Adaptive: recomendação, objetivo e lançamento são uma decisão. Indicadores
  são uma régua sem cartões; metas preservam uma superfície própria por serem
  editáveis; diagnósticos passam a listas.
- Navegação móvel: o nome exibido vem de `PRODUCT_BRAND`. A sigla da prova
  permanece no seletor, onde tem função.
- Temas: o escuro usa grafite esverdeado, o claro usa branco e um canvas
  levemente quente. Ambos compartilham a mesma hierarquia.

## Componentes e referências

As referências foram avaliadas como repertório de composição, não como tema a
instalar. O padrão de abas em linha do [ReUI](https://reui.io/components/tabs/c-tabs-2)
foi adaptado ao primitive Radix existente em `TabsList variant="line"`; o
estado e o foco seguem os tokens locais. A preferência por controls compostos
vem de [Origin UI](https://originui.com/). [Magic UI](https://magicui.design/)
e [Aceternity UI](https://ui.aceternity.com/components) foram consultados,
mas seus efeitos de partículas, spotlight e parallax não servem à leitura
analítica desta aplicação. [Kibo UI](https://www.kibo-ui.com/) é referência
para componentes complexos caso apareça uma necessidade funcional concreta.

Nenhuma nova biblioteca de interface foi adicionada. A identidade visível fica
em `src/components/Brand.tsx`; chaves de persistência e IDs de prova conservam
os valores históricos.

## Revisão

Revisar Home e Adaptive em 375, 425, 768, 1280 e 1440 px nos dois temas,
depois conferir as outras rotas com axe e capturas canônicas. Capturas
intencionais são geradas no Linux, conforme [testes visuais](visual-testing.md).
