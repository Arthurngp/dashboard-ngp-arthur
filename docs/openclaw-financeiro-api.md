# OpenClaw Financeiro API

Integração do agente financeiro do OpenClaw com o financeiro do NGP Space.

## Base URL

```text
https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/financeiro-openclaw
```

## Autenticação

Use um token gerado em:

```text
NGP Space > Admin > Integrações
```

Ao gerar, escolha uma expiração como 5, 15, 30, 60, 90, 180 ou 365 dias. Também existe a opção sem expiração, mas para agentes externos o recomendado é usar prazo definido e renovar periodicamente.

Header recomendado:

```http
x-ngp-api-token: ngp_live_...
Content-Type: application/json
```

O endpoint também aceita `Authorization: Bearer ngp_live_...`, mas `x-ngp-api-token` evita conflito com JWT do Supabase.

## Permissões

- `financeiro:read`: listar contas e categorias.
- `financeiro:create`: criar lançamentos.
- `financeiro:reports`: consultar briefing diário e resumo semanal.

## Ações

### Listar Contas

```json
{
  "action": "listar_contas"
}
```

### Listar Categorias

```json
{
  "action": "listar_categorias",
  "tipo": "saida"
}
```

`tipo` pode ser `entrada`, `saida` ou omitido.

### Criar Lançamento

```json
{
  "action": "criar_lancamento",
  "tipo": "saida",
  "descricao": "Almoço",
  "valor": 47.9,
  "data": "2026-05-03",
  "conta_nome": "Nubank",
  "categoria_sugerida": "Alimentação",
  "status": "confirmado",
  "source_tag": "API / OpenClaw",
  "origem": "Telegram/OpenClaw",
  "mensagem_original": "gastei 47,90 no almoço pelo Nubank"
}
```

Regras:

- `tipo`: `entrada` ou `saida`.
- `status`: `confirmado` para algo pago/recebido; `pendente` para algo a pagar/receber.
- `conta_nome`: deve existir em `fin_accounts`, como `Nubank`, `Inter`, `Itaú`.
- Se a categoria não existir, o NGP Space cria a categoria automaticamente.
- Se a conta não existir, a API retorna `code: account_not_found`.
- Todo lançamento criado pela API recebe `source_type: api` e `source_tag`, por padrão `API / OpenClaw`.
- Essa tag aparece na tabela do financeiro e também fica gravada no banco para auditoria.

### Briefing Diário

```json
{
  "action": "briefing_diario",
  "data": "2026-05-03"
}
```

Retorna:

- `a_pagar`
- `a_receber`
- `realizado`
- `resumo`

### Resumo Semanal

```json
{
  "action": "resumo_semanal",
  "reference_date": "2026-05-04"
}
```

Usa a semana de segunda a domingo da data de referência.

## Rotinas Sugeridas no OpenClaw

- Dias úteis, 08:00: chamar `briefing_diario`.
- Segunda, 08:00: chamar `resumo_semanal` para previsão da semana.
- Sexta, fim do dia: chamar `resumo_semanal` para realizado da semana.

## Segurança

- O OpenClaw não acessa o Supabase diretamente.
- O token completo aparece apenas uma vez ao gerar.
- O banco salva somente o hash do token.
- Tokens podem expirar automaticamente conforme o prazo escolhido.
- Cada chamada é auditada em `api_token_audit_logs`.
- Revogar o token em Admin > Integrações interrompe o acesso imediatamente.
