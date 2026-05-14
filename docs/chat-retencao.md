# Política de Retenção — Chat Interno NGP

Documento normativo sobre **persistência, backup e exclusão** de mensagens do chat interno (`team_chat_*`).

---

## 1. Princípio geral

Mensagens trocadas no chat interno da NGP **constituem evidência de trabalho** — comunicação operacional sobre clientes, decisões internas, anexos com material entregue. Por essa razão:

> Mensagens são **preservadas indefinidamente** no banco, salvo solicitação expressa de exclusão (LGPD).

---

## 2. Soft delete (botão 🗑 na mensagem)

Quando um usuário clica em "Apagar" no menu de uma mensagem:

- A linha **não é removida** do banco.
- A coluna `deleted_at` é preenchida com o timestamp da exclusão.
- A mensagem **deixa de aparecer** no chat para todos os usuários.
- O **texto original e os anexos vinculados continuam no banco/storage** para fins de auditoria.

Isso permite que, em caso de necessidade legal ou disputa, o conteúdo seja recuperado consultando diretamente o banco com role administrativa.

### Quem pode apagar?

- **Apenas o próprio autor** da mensagem (validado pela função RPC `team_chat_delete_message` com `SECURITY DEFINER`).
- Admins **não** apagam mensagens de terceiros pela UI — se for necessário, é via SQL direto com justificativa.

---

## 3. Hard delete (purga definitiva)

Existe a função `team_chat_purge_old_deleted_messages()` que apaga **definitivamente** mensagens com `deleted_at` mais antigo que **30 dias**.

- **Não roda automaticamente.** É executada manualmente quando o administrador decidir.
- Janela de 30 dias dá tempo para:
  - Resolver disputas curtas
  - Atender pedidos de retorno de mensagens deletadas por engano
  - Manter conformidade com LGPD (titular tem prazo razoável para recuperar)

Para executar:

```sql
SELECT public.team_chat_purge_old_deleted_messages();
-- retorna count de linhas apagadas
```

---

## 4. Backup externo

### Estratégia

O Supabase mantém backup automático do banco:

- **Plano Free:** 7 dias de retenção.
- **Plano Pro:** 30 dias + opção de PITR (Point-in-Time Recovery).

Sem redundância externa, qualquer incidente >7 dias é irrecuperável no plano atual. Por isso adotamos:

> **Backup local mensal** via script `scripts/backup-team-chat.mjs`.

### Como rodar

```bash
node scripts/backup-team-chat.mjs
```

O script:
- Lê todas as tabelas `public.team_chat_*` (canais, membros, mensagens, anexos metadata, reads, reactions).
- Exporta em JSON na pasta `~/ngp-chat-backups/`.
- Nome do arquivo: `team-chat-YYYY-MM-DD-HHMMSS.json`.
- Não inclui os arquivos físicos do Storage (apenas a referência `storage_path`).

### Anexos no Storage

Os arquivos físicos do bucket `team-chat-attachments` **devem ser baixados separadamente** se backup completo for necessário. Isso pode ser feito via dashboard ou via `supabase storage download` (CLI).

### Frequência recomendada

| Plano | Backup automático Supabase | Backup local recomendado |
|---|---|---|
| Free | 7 dias | Mensal |
| Pro | 30 dias | Trimestral |
| Pro + PITR | 30 dias + PITR 28d | Semestral |

---

## 5. LGPD — direito ao esquecimento

Se um membro da equipe **deixar a NGP** e solicitar exclusão das próprias mensagens:

1. Identifica-se o `usuario_id` na tabela `usuarios`.
2. Hard delete via SQL com justificativa anotada:

```sql
-- Exemplo: remover mensagens de um usuário específico
BEGIN;
DELETE FROM public.team_chat_reactions
  WHERE usuario_id = '<id>';
DELETE FROM public.team_chat_attachments
  WHERE message_id IN (
    SELECT id FROM public.team_chat_messages WHERE autor_usuario_id = '<id>'
  );
DELETE FROM public.team_chat_messages WHERE autor_usuario_id = '<id>';
COMMIT;
```

Anote a operação em log externo (caderno de DPO / planilha de pedidos LGPD) com data, motivo e usuário.

---

## 6. Auditoria

Para verificar quem apagou o quê:

```sql
SELECT
  m.id, m.texto, m.autor_usuario_id, u.nome AS autor,
  m.created_at, m.deleted_at, m.channel_id
FROM public.team_chat_messages m
LEFT JOIN public.usuarios u ON u.id = m.autor_usuario_id
WHERE m.deleted_at IS NOT NULL
ORDER BY m.deleted_at DESC;
```

Mensagens fixadas ficam visíveis para todos os membros do canal — equivalem a "fato registrado" para a equipe.

---

## 7. Resumo executivo

| Situação | O que acontece |
|---|---|
| Mensagem normal enviada | Persiste indefinidamente |
| Mensagem apagada (botão 🗑) | Soft delete — invisível na UI, preservada no banco |
| Mensagem soft-deleted há >30 dias | Pode ser purgada por hard delete manual |
| Disputa legal | Tudo recuperável até 30 dias após apagar |
| LGPD (pedido de exclusão) | Hard delete manual via SQL com justificativa |
| Incidente no banco | Recuperar pelo backup automático Supabase + backup local mensal |
