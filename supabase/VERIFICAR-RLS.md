# Verificar o RLS antes de confiar na nuvem

A chave publishable do Supabase é **pública por design** — ela vai no bundle e
qualquer pessoa que abra o site (ou o repositório) tem acesso a ela. Isso é
esperado. O que protege os dados é o **RLS**, não a chave.

Rode a checagem abaixo. Ela leva um minuto e responde a única pergunta que
importa: *sem estar logado, dá para ler o estado dos outros?*

## 1. Aplicar o schema

Supabase → SQL Editor → cole e rode `supabase/schema.sql` inteiro. É idempotente.

## 2. Testar sem autenticação

Substitua `SUA_URL` e `SUA_CHAVE` e rode no terminal:

```bash
curl -s -w "\nHTTP %{http_code}\n" "SUA_URL/rest/v1/user_state?select=*&limit=5" -H "apikey: SUA_CHAVE"
```

**Resultado esperado (seguro):** `HTTP 200` com corpo `[]`, ou `HTTP 401`.
Uma lista vazia significa que o RLS filtrou tudo — é o correto.

**Resultado perigoso:** qualquer linha com `user_id`, `data` ou `revision`.
Se isso acontecer, o RLS está desligado ou mal configurado e **os dados de
todos os usuários estão expostos**. Rode o `schema.sql` e teste de novo.

## 3. Testar que um usuário logado não vê o outro

Com dois usuários criados, pegue o `access_token` de um deles (o app guarda a
sessão no `localStorage`) e rode:

```bash
curl -s "SUA_URL/rest/v1/user_state?select=user_id&limit=50" -H "apikey: SUA_CHAVE" -H "Authorization: Bearer TOKEN_DO_USUARIO_A"
```

Deve voltar **no máximo uma linha**, com o `user_id` do próprio usuário A.
Se aparecer o `user_id` do usuário B, as políticas não estão aplicadas.

## 4. Confirmar no banco

```sql
select relname, relrowsecurity, relforcerowsecurity
  from pg_class where relname = 'user_state';
```

As duas colunas booleanas precisam vir `true`.

```sql
select policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename = 'user_state';
```

Devem aparecer quatro políticas, todas para o papel `authenticated`.
Se alguma estiver com `{public}` ou `{anon}`, corrija — é brecha.

## Por que a RPC usa `security invoker`

`sync_user_state` roda **como o usuário que chamou**, então o RLS continua
valendo dentro dela. Se fosse `security definer`, ela ignoraria as políticas e
passaria a ser o elo mais fraco: bastaria um erro na função para expor tudo.
