# ADR 0001 — Studium como produto; provas como providers

- **Status:** aceito
- **Data:** 2026-09-27
- **Issue:** #86

## Contexto

O produto nasceu como **ENEM Lab**, mas a arquitetura evoluiu para suportar várias provas. O registry atual inclui ENEM, ITA, IME e diversos vestibulares/militares. Em paralelo, partes da infraestrutura e do pipeline já usam o nome **Studium**.

Manter duas marcas públicas faria a UI sugerir que cada provider é um produto diferente ou que “ENEM Lab” ainda descreve toda a plataforma. Fazer uma renomeação técnica em massa, porém, quebraria chaves persistidas e criaria risco sem benefício funcional.

## Decisão

**Studium é o nome do produto/plataforma.**

ENEM, ITA, IME, Fuvest e demais provas são **providers** dentro do Studium.

O vocabulário normativo é:

- **produto/plataforma:** Studium;
- **provider:** integração de uma prova;
- **fonte/source:** documento ou origem do conteúdo;
- **NativePack:** formato normalizado de conteúdo nativo;
- **Native Fleet:** automação de preparo, validação e publicação do corpus.

“ENEM Lab” passa a ser apenas um identificador legado. Novas strings públicas, documentação e módulos não devem tratá-lo como marca atual.

## Compatibilidade

Esta decisão **não autoriza renomeação em massa** de identificadores persistidos.

Devem permanecer estáveis até existir uma migração específica:

- `enem_lab_v7`;
- chaves de sessão/sincronização com prefixo `enem_lab_`;
- nomes históricos de pastas/classes que não aparecem para o usuário;
- nome do repositório e outros identificadores externos já integrados.

Uma migração futura só pode remover esses nomes se implementar leitura do legado, transferência segura e testes de não perda de histórico.

## Consequências

### Positivas

- a marca passa a representar corretamente uma plataforma multi-provider;
- a UI deixa de misturar “Studium” e “ENEM Lab” como se fossem produtos diferentes;
- documentação e novos módulos passam a usar um vocabulário previsível;
- compatibilidade local-first é preservada.

### Custos

- alguns identificadores internos continuarão contendo `enem_lab` por um período;
- paths como `src/components/enem-lab/` continuam legados até haver motivo funcional para migrá-los;
- o nome do repositório não precisa acompanhar a marca imediatamente.

## Regra para novos módulos

Antes de introduzir nomes:

1. use **Studium** apenas para o produto;
2. use o `providerId`/rótulo da prova para contexto acadêmico;
3. use **source/fonte** para procedência;
4. use **NativePack/Native Fleet** apenas para o pipeline de corpus;
5. não crie novas chaves persistidas com `enem_lab`;
6. não renomeie chaves antigas sem uma migração explícita e testada.
