# Fluxo de estudo do ENEM Lab

Este documento define a hierarquia de produto da navegação. A inteligência interna pode ter vários motores; o aluno não deve precisar escolher um motor para descobrir o que fazer agora.

## Caminho principal

A Home é o centro de decisão. A missão em destaque sempre aponta para a próxima ação útil de acordo com o estado atual: retomar uma sessão, fazer revisões vencidas, trabalhar um gargalo ou calibrar o histórico.

No primeiro nível da navegação ficam apenas:

- **Início** — próxima ação e sinais essenciais.
- **Plano de hoje** — sequência priorizada de blocos para o tempo disponível.
- **Banco** — exploração manual de questões.
- **Revisões** — fila de retenção já vencida.

Domínio, Histórico e Erros formam a camada de acompanhamento. Eles explicam o que aconteceu; não competem com a ação recomendada.

## Ferramentas avançadas

**Treino manual** (`/practice`) existe para quando o aluno quer escolher explicitamente prova, ano, área, formato, duração ou simulação. Não é o caminho padrão para decidir o próximo estudo.

**Motor adaptativo** (`/adaptive`) expõe objetivos, sinais, evidências, experimentos e decisões do mecanismo adaptativo. Ele é uma superfície avançada para inspeção e controle, não uma etapa obrigatória da rotina.

**Plano de hoje** (`/plano`) é a interface recomendada para executar o estudo diário. Ele usa os mesmos sinais de retenção, fraqueza e cobertura sem exigir que o aluno entenda qual motor gerou cada bloco.

## Regras de navegação

Desktop e mobile usam a mesma prioridade. O mobile mantém Início, Plano, Banco e Revisões na barra inferior. Treino manual, Motor adaptativo, Dados e Conta ficam em **Mais**. No desktop, as ferramentas avançadas também ficam recolhidas em **Mais** e abrem automaticamente quando o usuário já está em uma dessas rotas.

Nenhuma rota foi removida. Simplificar significa reduzir competição visual, não retirar capacidade.

## Jornada mínima protegida por E2E

A jornada essencial é:

`Home → próxima ação → configuração quando necessária → sessão → resultado`.

O teste de fumaça cobre essa sequência com estado local determinístico e API interceptada, além de verificar a mesma prioridade de navegação no desktop e no mobile.
