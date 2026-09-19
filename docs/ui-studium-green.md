# Studium Labs — Ultimate Green Edition

A interface trata estudo como trabalho intelectual cotidiano: uma decisão clara,
evidências legíveis e caminhos secundários que não competem com a próxima ação.
“Ultimate Green” é apenas o nome da edição. Preto, cinza e branco compõem a
identidade; títulos, números, linhas e espaço organizam o conteúdo.

## Hierarquia visual

- Home: a próxima sessão ocupa o único painel de destaque. Prontidão é um
  número, o ciclo é uma faixa de dados e as seções analíticas são agrupadas por
  linhas e alinhamento.
- Adaptive: sessão, diagnóstico, metas e histórico são áreas navegáveis.
  Escolher objetivo usa Choicebox; o ciclo usa Timeline. Rascunhos de metas
  são preservados ao trocar de aba.
- Navegação móvel: o nome exibido vem de `PRODUCT_BRAND`. A sigla da prova
  permanece no seletor, onde tem função.
- Temas: grafite neutro no escuro e branco no claro, sem pigmentação verde.

## Componentes e referências

O código do [ReUI Timeline](https://github.com/keenthemes/reui/blob/main/registry-reui/bases/radix/reui/timeline.tsx)
foi incorporado ao ciclo de estudo, horizontal no desktop e vertical no mobile.
O [Kibo UI Choicebox](https://www.kibo-ui.com/components/choicebox) foi adaptado
ao Radix existente para a escolha do objetivo, com título, descrição e indicador.
Ambos têm exemplos no Storybook. Licenças e origens estão em
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Nenhuma nova biblioteca de interface foi adicionada. A identidade visível fica
em `src/components/Brand.tsx`; chaves de persistência e IDs de prova conservam
os valores históricos.

## Revisão

Revisar Home e Adaptive em 375, 425, 768, 1280 e 1440 px nos dois temas,
depois conferir as outras rotas com axe e capturas canônicas. Capturas
intencionais são geradas no Linux, conforme [testes visuais](visual-testing.md).
