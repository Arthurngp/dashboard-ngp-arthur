# OpenClaw Financeiro API

API HTTP do agente financeiro externo (OpenClaw, n8n, etc) para o financeiro do NGP Space.

## Base URL

```text
https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/financeiro-openclaw
```

Toda chamada é `POST` com `Content-Type: application/json`. O `action` no corpo determina a operação.

## Autenticação

Token gerado em **NGP Space > Admin > Integrações**. Expirações disponíveis: 5, 15, 30, 60, 90, 180, 365 dias ou sem expiração (agentes externos: use prazo definido e renove).

Header recomendado:

```http
x-ngp-api-token: ngp_live_...
Content-Type: application/json
```

Também aceita `Authorization: Bearer ngp_live_...`, mas `x-ngp-api-token` evita conflito com JWT do Supabase.

## Scopes

| Scope | Sensibilidade | Cobertura |
|---|---|---|
| `financeiro:read` | Baixa | Listar contas, categorias, lançamentos, clientes, fornecedores |
| `financeiro:create` | Média | Criar lançamentos |
| `financeiro:reports` | Baixa | Briefing diário, resumo semanal, resumo de período |
| `financeiro:update` | Média | Atualizar lançamentos, confirmar pendentes, reclassificar categoria |
| `financeiro:delete` | **Alta** | Soft delete + restauração de lançamentos |

A box "Acesso básico ao Financeiro" cobre `read + create + reports`. As ações sensíveis (`update`, `delete`) são toggles individuais com confirmação extra na UI.

## Convenções

- **Datas:** sempre `YYYY-MM-DD` (string).
- **Valores monetários:** número decimal positivo (ex: `47.90`). Aceita também string com `R$` prefix e separadores BR (`"R$ 1.234,56"`) — a API normaliza.
- **UUIDs:** validados por regex.
- **`view`:** `caixa` (filtra por `payment_date`) ou `competencia` (default, filtra por `competence_date`).
- **`status`:** `confirmado` (pago/recebido) ou `pendente` (a pagar/receber).
- **`tipo`:** `entrada`, `saida` ou `transferencia`.
- **Limite de massa:** 50 items por chamada em qualquer action que aceita `ids[]` ou filtros.
- **Audit log:** toda chamada (sucesso ou erro) grava em `api_token_audit_logs` com payload de request/response.

---

# Ações

## 📖 Leituras (`financeiro:read`)

### `listar_contas`

Retorna contas ativas com saldo real (`saldo_inicial + soma de transações confirmadas não-deletadas`) e totais agregados.

```json
{ "action": "listar_contas" }
```

**Retorna:**

```json
{
  "accounts": [
    {
      "id": "...",
      "nome": "Banco Inter",
      "tipo": "conta_corrente",
      "saldo_inicial": 0,
      "saldo_atual": 1984.47,
      "incluir_no_saldo": true
    }
  ],
  "saldo_total": 1984.47,
  "saldo_investimentos": 2795.37,
  "saldo_poupanca": 842.93
}
```

- `saldo_total` = soma de contas correntes (`tipo` em `conta_corrente`/`banco`) com `incluir_no_saldo=true`.
- `saldo_investimentos` / `saldo_poupanca` = idem para os respectivos tipos.

### `listar_categorias`

```json
{ "action": "listar_categorias", "tipo": "saida" }
```

`tipo` é opcional (`entrada` | `saida`). Sem filtro, retorna todas.

### `listar_lancamentos`

Filtros e paginação manual. Aceita JOIN com account/categoria/cliente/fornecedor.

```json
{
  "action": "listar_lancamentos",
  "start": "2026-05-01",
  "end": "2026-05-31",
  "tipo": "saida",
  "status": "pendente",
  "account_id": "...",
  "categoria_id": "...",
  "cliente_id": "...",
  "fornecedor_id": "...",
  "view": "competencia",
  "limit": 100,
  "offset": 0
}
```

**Defaults:** `view=competencia`, `limit=100` (max 500), `offset=0`. Todos os filtros são opcionais.

**Retorna:** `{ period, view, total, limit, offset, has_more, lancamentos[], resumo }`. `total` vem com `count: exact` do PostgREST. `resumo` é `{ entradas, saidas, saldo, a_pagar, a_receber }`.

### `listar_clientes`

```json
{ "action": "listar_clientes", "limit": 200 }
```

Retorna clientes ativos + `saldo_a_receber` calculado (soma de pendentes de tipo=entrada por cliente_id).

### `listar_fornecedores`

```json
{ "action": "listar_fornecedores", "limit": 200 }
```

Retorna fornecedores ativos + `saldo_a_pagar` (soma de pendentes de tipo=saida).

---

## ➕ Criação (`financeiro:create`)

### `criar_lancamento`

```json
{
  "action": "criar_lancamento",
  "tipo": "saida",
  "descricao": "Almoço",
  "valor": 47.90,
  "data": "2026-05-03",
  "conta_nome": "Nubank",
  "categoria_sugerida": "Alimentação",
  "status": "confirmado",
  "source_tag": "API / OpenClaw",
  "origem": "Telegram/OpenClaw",
  "mensagem_original": "gastei 47,90 no almoço pelo Nubank"
}
```

**Regras:**
- `tipo`: `entrada` ou `saida`.
- `status`: `confirmado` (pago/recebido) ou `pendente` (a pagar/receber).
- `conta_nome` ou `account_id`: pelo menos um deve ser informado. Se a conta não existe, retorna `{ code: "account_not_found" }`.
- Se a categoria não existir, é **criada automaticamente**.
- Todo lançamento via API recebe `source_type='api'` e `source_tag` (default `API / OpenClaw`).
- `payment_date`: opcional. Se `status=confirmado` e ausente, usa `data`.

---

## ✏️ Mutações (`financeiro:update`)

### `atualizar_lancamento`

Patch parcial em UM lançamento. Aceita só os campos enviados.

```json
{
  "action": "atualizar_lancamento",
  "id": "uuid-do-lancamento",
  "descricao": "Almoço corrigido",
  "valor": 52.50,
  "status": "confirmado",
  "competence_date": "2026-05-03",
  "payment_date": "2026-05-03",
  "categoria_id": "...",
  "account_id": "...",
  "cliente_id": null,
  "fornecedor_id": null,
  "observacoes": "...",
  "source_tag": "..."
}
```

**Regras:**
- `id` obrigatório (UUID).
- `tipo` **NÃO é editável** (não permite trocar entrada↔saida sem recriar).
- `valor` precisa ser > 0.
- Datas: `YYYY-MM-DD` ou `null`.
- `status='pendente'` sem `payment_date` explícito → limpa `payment_date`.
- Pelo menos 1 campo editável obrigatório.
- Audit grava `before` + `after` + `changed_fields[]`.

### `confirmar_pendente`

Atalho: muda `status='pendente'` → `'confirmado'` + define `payment_date`.

```json
{
  "action": "confirmar_pendente",
  "ids": ["uuid-1", "uuid-2"],
  "payment_date": "2026-05-10"
}
```

- `ids[]`: max 50.
- `payment_date`: opcional (default = hoje UTC).
- Idempotente: ids já confirmados retornam silenciosamente (não erro).

### `reclassificar_categoria`

Reclassificação em massa. Mesma proteção do delete: **dry_run obrigatório + confirmation_token**.

**Etapa 1 — dry_run** (preview, gera token):

```json
{
  "action": "reclassificar_categoria",
  "dry_run": true,
  "ids": ["uuid-1", "uuid-2"],
  "nova_categoria_id": "uuid-da-categoria-destino"
}
```

OU com filtros:

```json
{
  "action": "reclassificar_categoria",
  "dry_run": true,
  "start": "2026-05-01",
  "end": "2026-05-31",
  "categoria_id_atual": "uuid-da-categoria-origem",
  "nova_categoria_id": "uuid-da-categoria-destino"
}
```

**Retorna:** `{ count, total_value, would_update[], confirmation_token, expires_at }`.

**Etapa 2 — commit** (aplica):

```json
{
  "action": "reclassificar_categoria",
  "dry_run": false,
  "ids": ["uuid-1", "uuid-2"],
  "nova_categoria_id": "uuid-da-categoria-destino",
  "confirmation_token": "uuid-retornado-no-dry_run"
}
```

**Regras:**
- `nova_categoria_id`: UUID ou `null` (para "sem categoria").
- Hash do confirmation_token = `sha256(ids_ordenados + "|" + nova_categoria_id)`. Trocar a categoria-alvo entre dry_run e commit é detectado e recusado (HTTP 409).
- TTL do token: **5 minutos**. Token consumido não pode ser reusado.
- Limite 50 items.
- Filtros aceitos: `start`, `end`, `tipo`, `status`, `account_id`, `categoria_id_atual`, `cliente_id`, `fornecedor_id`, `view`.

---

## 🗑️ Deletes (`financeiro:delete`)

**Soft delete** com janela de 30 dias para reversão. Aplica `deleted_at` mas mantém a linha no banco. Cron de purga remove fisicamente após 30 dias.

### `deletar_lancamento`

Mesmo fluxo dry_run + confirmation_token do `reclassificar_categoria`.

**Etapa 1 — dry_run:**

```json
{
  "action": "deletar_lancamento",
  "dry_run": true,
  "ids": ["uuid-1", "uuid-2"]
}
```

OU com filtros (mesmos do `listar_lancamentos`):

```json
{
  "action": "deletar_lancamento",
  "dry_run": true,
  "start": "2026-04-01",
  "end": "2026-04-30",
  "tipo": "saida",
  "status": "confirmado"
}
```

**Retorna:** `{ count, total_value, would_delete[], confirmation_token, expires_at, transferencia_pares_inclusos[] }`.

**Etapa 2 — commit:**

```json
{
  "action": "deletar_lancamento",
  "dry_run": false,
  "ids": ["uuid-1", "uuid-2"],
  "confirmation_token": "uuid-retornado-no-dry_run"
}
```

**Regras de segurança:**
- **Default seguro:** sem `permitir_origem_externa: true`, só apaga lançamentos com `source_type='api'` (criados pela própria API).
- **`permitir_origem_externa: true`:** libera apagar manuais e import_csv. Use com cuidado.
- **Limite 50 items.**
- **Hash sha256** dos ids ordenados (anti-bait-and-switch). Filtros que retornam set diferente entre dry_run e commit são recusados (HTTP 409).
- **Token consumed_at** impede reuso (HTTP 409).
- **TTL 5 minutos.**
- **Transferências em par** detectadas automaticamente: se filtro pegar uma ponta de `tipo='transferencia'`, a contraparte é incluída na deleção (saldos das contas não divergem).
- **Audit:** `deleted_by_token_id` grava qual token apagou (FK em `api_tokens`).

### `restaurar_lancamento`

Reverte soft delete (`deleted_at = NULL`). Não requer dry_run (ação restauradora).

```json
{
  "action": "restaurar_lancamento",
  "ids": ["uuid-1", "uuid-2"]
}
```

- `ids[]`: max 50.
- Idempotente: ids ativos (não-deletados) retornam silenciosamente sem erro.

---

## 📊 Relatórios (`financeiro:reports`)

### `briefing_diario`

```json
{ "action": "briefing_diario", "data": "2026-05-03" }
```

Retorna `a_pagar`, `a_receber`, `realizado`, `resumo` para o dia.

### `resumo_semanal`

```json
{ "action": "resumo_semanal", "reference_date": "2026-05-04" }
```

Usa a semana de segunda a domingo contendo `reference_date`.

### `resumo_periodo`

Generaliza `briefing_diario` / `resumo_semanal` para qualquer janela. Pagina internamente para suportar períodos longos (>1000 transações).

```json
{
  "action": "resumo_periodo",
  "start": "2026-04-01",
  "end": "2026-04-30",
  "view": "caixa",
  "account_id": "..."
}
```

- `start` e `end` obrigatórios (YYYY-MM-DD).
- `view`: `caixa` (`payment_date`) ou `competencia` (default).
- `account_id` opcional (filtra por conta específica).

**Retorna:** `{ period, view, total, resumo, a_pagar[], a_receber[], realizado[] }`.

---

## Códigos de erro comuns

| HTTP | Quando |
|---|---|
| 400 | Validação de input falhou (campo obrigatório ausente, formato inválido, valor < 0, etc) |
| 401 | Token inválido/expirado/revogado |
| 403 | Token sem o scope necessário |
| 404 | Lançamento não encontrado ou conta não existe (`code: account_not_found`) |
| 409 | `confirmation_token` já consumido, expirado, ou conjunto de IDs mudou desde o dry_run |
| 410 | `confirmation_token` expirado (>5min) |
| 500 | Erro interno do banco/edge function |

---

## Rotinas sugeridas

- **Dias úteis, 08:00:** `briefing_diario` → posta no Slack/WhatsApp do time.
- **Segunda, 08:00:** `resumo_semanal` (previsão da semana).
- **Sexta, fim do dia:** `resumo_semanal` (realizado vs previsto).
- **Mensal, dia 1, 09:00:** `resumo_periodo` do mês anterior.
- **Sob demanda:** `criar_lancamento` para registrar despesas a partir de mensagens, comprovantes etc.

---

## Segurança

- **OpenClaw não acessa o Supabase diretamente** — só esta edge function.
- **Token completo aparece uma vez** ao gerar; o banco só salva o hash sha256.
- **Tokens podem expirar** automaticamente conforme o prazo.
- **Toda chamada é auditada** em `api_token_audit_logs` (`request_payload`, `response_payload`, `ip`, `user_agent`).
- **Revogar o token** em Admin > Integrações interrompe o acesso imediatamente.
- **Soft delete** preserva 30 dias para reversão. Cron purga após.
- **`source_type='api'` filter** em delete protege lançamentos manuais por default.
- **Hash anti-bait-and-switch** garante que o set apagado/reclassificado é exatamente o que foi previewado no dry_run.

---

## Apêndice: estrutura `fin_delete_confirmations`

A tabela `fin_delete_confirmations` armazena tokens de dry_run para `deletar_lancamento` e `reclassificar_categoria`:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | UUID | O `confirmation_token` retornado |
| `api_token_id` | UUID FK | Quem solicitou (FK em `api_tokens`) |
| `target_ids` | UUID[] | IDs que serão afetados (ordenados) |
| `target_hash` | TEXT | sha256 dos `target_ids.join(',')` (delete) ou `+'|'+ nova_categoria_id` (reclassificar) |
| `filtros_snapshot` | JSONB | Filtros do dry_run para auditoria |
| `total_value` | NUMERIC | Soma dos valores afetados |
| `created_at` | TIMESTAMPTZ | Quando foi criado |
| `expires_at` | TIMESTAMPTZ | Default `created_at + 5min` |
| `consumed_at` | TIMESTAMPTZ NULL | Marcado quando o commit é executado (impede reuso) |

RLS habilitado, sem policy = só `service_role` (edge functions). Tabela invisível para anon e authenticated.
