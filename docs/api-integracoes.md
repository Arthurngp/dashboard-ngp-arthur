# PRD — API Integrações por Setor

**Status:** proposta
**Autor:** Arthur Oliveira
**Data:** 2026-05-09
**Escopo:** página `/admin/integracoes` (UI de geração de tokens) + modelo de scopes do `api_tokens`.

---

## 1. Contexto

Hoje a página `/admin/integracoes` lista permissões soltas, sem agrupamento (`financeiro:read`, `financeiro:create`, `financeiro:reports`, `feedback:read`, `feedback:update`). Cada nova API (ex.: comercial, pessoas, tarefas) adiciona N entradas planas — a tela vira uma checklist longa, fácil de marcar errado e difícil de comunicar para quem não conhece o backend.

A operação real é mais simples do que isso: o admin pensa por **setor** ("quero dar acesso ao Financeiro") e ocasionalmente quer **liberar uma ação delicada** (excluir lançamento, atualizar status de feedback). Essa é a UX que precisamos refletir.

A migração para essa nova UI aconteceu junto com a evolução da feature de feedbacks (botão flutuante + página admin + edge function `feedback-api` para varredura autônoma do agente OpenClaw).

## 2. Objetivos

1. **Reduzir atrito**: gerar um token para um setor inteiro com 1 ou 2 cliques.
2. **Tornar ações delicadas explícitas**: exclusão, atualização de status e qualquer mutação destrutiva precisa de toggle individual, com aviso visual.
3. **Padronizar como novos setores entram**: convenção clara de nomenclatura e estrutura, para que adicionar Comercial / Pessoas / Tarefas seja replicar o template sem repensar UX.
4. **Manter compatibilidade**: tokens já emitidos continuam válidos. Não renomear scopes existentes.

## 3. Não-objetivos

- Não vamos implementar agora as APIs de Comercial, Pessoas ou Tarefas. Esta proposta apenas reserva o espaço delas na UI ("em breve").
- Não vamos mudar o modelo de armazenamento (`api_tokens.scopes` continua `text[]`). A mudança é de **agrupamento e apresentação**, não de schema.
- Não vamos introduzir RBAC por usuário-final no token. O token continua sendo do sistema (admin gera, agente externo consome).

## 4. Público-alvo

- **Admin do NGP Space** (Arthur, Nathalli) gerando tokens para agentes externos (ex.: OpenClaw varrendo bugs / lançando despesas).
- **Desenvolvedores** consumindo a API: precisam de uma documentação clara de quais scopes liberam o quê.

---

## 5. Modelo de scopes — convenção

### 5.1 Formato

```
<setor>:<acao>
```

`<setor>` é minúsculo, sem hífen quando possível. `<acao>` segue um vocabulário fechado:

| Ação        | Significado                                                          | Sensibilidade |
|-------------|----------------------------------------------------------------------|---------------|
| `read`      | Listar e consultar dados                                             | Baixa         |
| `create`    | Inserir novos registros                                              | Média         |
| `update`    | Atualizar campos de registros existentes                             | Média         |
| `delete`    | Apagar registros                                                     | **Alta**      |
| `reports`   | Endpoints agregados (briefing, resumo, dashboards)                   | Baixa         |

Quando um endpoint não couber em `read/create/update/delete/reports`, criar um verbo específico (ex.: `feedback:answer`, `tarefas:assign`) e classificá-lo como média ou alta sensibilidade.

### 5.2 Agrupamento por setor (UX)

Cada **setor** vira uma "Box" na UI com:

- 1 **scope básico** marcado por padrão quando a box é ligada (geralmente `:read` + ações não-destrutivas tipicamente seguras).
- N **scopes opcionais** apresentados como checkboxes secundários, com aviso visual quando forem destrutivos.

O `scope básico` é uma escolha editorial — não existe no banco. Na hora de salvar, a UI traduz "Financeiro básico" no array concreto de scopes (`['financeiro:read', 'financeiro:create', 'financeiro:reports']`).

### 5.3 Mapeamento atual

#### Box Financeiro

| Toggle UI                      | Scopes reais                                                     | Default | Sensibilidade |
|--------------------------------|-------------------------------------------------------------------|---------|---------------|
| Acesso básico ao Financeiro    | `financeiro:read`, `financeiro:create`, `financeiro:reports`      | ligado  | Baixa/Média   |
| Atualizar lançamentos          | `financeiro:update`                                               | desligado | Média       |
| Excluir lançamentos            | `financeiro:delete`                                               | desligado | **Alta**    |

> `financeiro:update` e `financeiro:delete` foram implementados em `financeiro-openclaw` v9 (2026-05-09). Tokens com esses scopes têm acesso às 14 actions documentadas em `docs/openclaw-financeiro-api.md`.

#### Box Feedbacks

| Toggle UI                              | Scopes reais         | Default | Sensibilidade |
|----------------------------------------|----------------------|---------|---------------|
| Ler feedbacks dos usuários             | `feedback:read`      | ligado  | Baixa         |
| Atualizar status / responder           | `feedback:update`    | desligado | Média        |

#### Boxes futuras (em breve)

- **Comercial** — leads, propostas, follow-ups (`comercial:read`, `comercial:create`, `comercial:update`, `comercial:delete`).
- **Pessoas** — colaboradores, ponto, carreira (`pessoas:read`, `pessoas:update`).
- **Tarefas** — listas, cards, atribuições (`tarefas:read`, `tarefas:create`, `tarefas:update`, `tarefas:assign`).

Aparecem como boxes desabilitadas com badge "Em breve" e descrição. Não geram scopes ao salvar.

---

## 6. UX da página /admin/integracoes

### 6.1 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Admin · Segurança                                                 │
│ Integrações                                                       │
│ Gere tokens de API para agentes externos (OpenClaw, automações).  │
├──────────────────────────────────────────────────────────────────┤
│ Novo token de API                                                 │
│                                                                   │
│ [ Nome: __________________ ]   [ Expiração: 30 dias ▾ ]           │
│                                                                   │
│ Escolha os setores e ações                                        │
│                                                                   │
│ ┌─ Financeiro ───────────────────────────────┐                   │
│ │ [✓] Acesso básico ao financeiro             │  baixa/média     │
│ │     Listar contas, categorias, criar        │                   │
│ │     lançamentos e consultar relatórios.     │                   │
│ │                                              │                   │
│ │ [ ] Excluir lançamentos        ⚠  alta      │                   │
│ │     Ação destrutiva. Permite apagar         │                   │
│ │     registros financeiros via API.          │                   │
│ └─────────────────────────────────────────────┘                   │
│                                                                   │
│ ┌─ Feedbacks ────────────────────────────────┐                   │
│ │ [✓] Ler feedbacks dos usuários              │  baixa           │
│ │ [ ] Atualizar status / responder    média   │                   │
│ └─────────────────────────────────────────────┘                   │
│                                                                   │
│ ┌─ Comercial ────────────────── [Em breve] ──┐                   │
│ │ Endpoints de leads e propostas.             │                   │
│ └─────────────────────────────────────────────┘                   │
│                                                                   │
│ [ Gerar token ]                                                   │
├──────────────────────────────────────────────────────────────────┤
│ Tokens existentes                                                 │
│ ...tabela...                                                      │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Comportamentos

- **Ligar a box do setor** = marcar automaticamente o "scope básico" daquele setor. Desligar a box desmarca tudo daquele setor.
- **Toggles secundários** ficam desabilitados (cinza) enquanto a box do setor estiver desligada — fica claro que dependem dela.
- **Ações de alta sensibilidade** (`delete` e similares) recebem ícone de aviso (⚠), label "Alta" colorida em vermelho (`#CC1414`), e exigem **confirmação extra** antes de salvar (modal: "Você está liberando exclusão de lançamentos. Isso é irreversível pela API. Continuar?").
- **Pelo menos um setor precisa estar ligado** para o botão "Gerar token" habilitar. Sem isso, banner explicativo: "Selecione ao menos um setor".
- **Exibição do token gerado** mantém o comportamento atual (token completo aparece uma vez, depois só hash).

### 6.3 Painel "Tokens existentes"

Tabela já existe. Mudanças:

- Coluna "Permissões" hoje mostra todos os scopes em badges. Trocar por badges agrupadas por setor: `Financeiro · básico` e `Financeiro · excluir` em vez de 4 chips separados.
- Adicionar tooltip ao passar o mouse mostrando os scopes literais (para debug).

---

## 7. Modelo de dados

Sem alteração de schema. O array `api_tokens.scopes` continua sendo a fonte da verdade.

A "tradução box → scopes" mora no frontend (constante em `app/admin/integracoes/page.tsx` ou idealmente em `lib/api-scopes.ts` para reuso futuro). Estrutura sugerida:

```ts
// lib/api-scopes.ts
export interface SetorBox {
  id: string                      // 'financeiro' | 'feedback' | ...
  label: string                   // 'Financeiro'
  description: string
  status: 'disponivel' | 'em_breve'
  basico: {
    label: string                 // 'Acesso básico ao financeiro'
    description: string
    scopes: string[]              // ['financeiro:read', 'financeiro:create', 'financeiro:reports']
    sensibilidade: 'baixa' | 'media' | 'alta'
  }
  acoesDelicadas: Array<{
    id: string                    // 'financeiro:delete'
    label: string                 // 'Excluir lançamentos'
    description: string
    sensibilidade: 'baixa' | 'media' | 'alta'
    requerConfirmacao?: boolean
  }>
}

export const SETOR_BOXES: SetorBox[] = [...]
```

Centralizar isso permite que o backend (`admin-api-tokens` `AVAILABLE_SCOPES`) leia a mesma fonte e valide consistentemente. Em prática, gerar `AVAILABLE_SCOPES` a partir de `SETOR_BOXES` (export compartilhado via copy ou via migration do tipo).

---

## 8. Migração

1. **Frontend**: refatorar `app/admin/integracoes/page.tsx` para usar `SETOR_BOXES`. Tokens antigos continuam funcionando (a UI "lê de volta" um token e marca as boxes que cobrem aqueles scopes).
2. **Backend**: nenhuma migration de banco. `AVAILABLE_SCOPES` cresce conforme novos setores ganham API.
3. **Documentação**: este PRD vira referência. `docs/openclaw-financeiro-api.md` continua válido — só adicionar uma nota apontando que `financeiro:delete` ainda não está implementado.

## 9. Fases de entrega

### Fase 1 — Refatoração da UI (esta proposta)
- Criar `lib/api-scopes.ts` com `SETOR_BOXES` cobrindo Financeiro e Feedbacks.
- Reescrever `app/admin/integracoes/page.tsx` no novo layout.
- Adicionar confirmação para ações de alta sensibilidade.
- Atualizar tabela de tokens existentes com badges agrupadas.

### Fase 2 — Implementar scopes faltantes no backend ✅ Concluída (2026-05-09)

**Implementado em `financeiro-openclaw` v9:**

- `financeiro:update` adicionado: 3 actions (`atualizar_lancamento`, `confirmar_pendente`, `reclassificar_categoria`).
- `financeiro:delete` adicionado: 2 actions (`deletar_lancamento`, `restaurar_lancamento`).
- Soft delete via `fin_transacoes.deleted_at`, com janela de 30 dias para reversão.
- Tabela `fin_delete_confirmations` (RLS service_role only) armazena tokens de dry_run com hash sha256 anti-bait-and-switch e TTL 5min.
- Tier de leitura também ampliado: `listar_lancamentos`, `listar_clientes`, `listar_fornecedores`, `resumo_periodo`. `listar_contas` agora inclui `saldo_atual` e totais agregados.

**Documentação completa das 14 actions:** `docs/openclaw-financeiro-api.md`.

**Pendente:**

- Avaliar `feedback:delete` (apagar feedback duplicado / spam).

### Fase 3 — Boxes "Em breve" viram disponíveis
- Conforme cada setor (Comercial, Pessoas, Tarefas) ganha edge function própria, troca o badge "Em breve" pelo conjunto real de toggles.
- Cada novo setor segue o template: 1 scope básico + N ações delicadas.

## 10. Critérios de aceitação

- [ ] Admin consegue gerar token "só Financeiro" em ≤ 3 cliques (Nome → marcar box → Gerar).
- [ ] Tentar gerar token sem nenhum setor mostra erro explícito.
- [ ] Marcar `financeiro:delete` exige confirmação modal.
- [ ] Tokens já existentes aparecem na tabela com badges no novo formato sem perder informação.
- [ ] Adicionar um novo setor (ex.: Comercial) requer apenas: implementar a edge function + adicionar 1 entrada em `SETOR_BOXES`. Nenhuma mudança em layout.

## 11. Riscos e mitigação

| Risco                                                     | Mitigação                                                              |
|-----------------------------------------------------------|------------------------------------------------------------------------|
| Admin marca "Excluir" achando que é necessário e libera   | Confirmação modal + label vermelho + descrição "Ação destrutiva".      |
| Token antigo com scope que sumiu da UI                    | Manter `AVAILABLE_SCOPES` no backend. UI lista o scope desconhecido como "raw" no detalhe do token. |
| Divergência entre `SETOR_BOXES` (frontend) e `AVAILABLE_SCOPES` (backend) | Gerar `AVAILABLE_SCOPES` a partir do mesmo arquivo (build-time ou copy compartilhado). |
| Setor "Em breve" gera expectativa sem entrega             | Só listar setores quando houver compromisso de entrega no trimestre.   |

## 12. Referências

- Edge function existente: `supabase/functions/admin-api-tokens/index.ts`
- Edge function de feedback (consumidora): `supabase/functions/feedback-api/index.ts`
- Doc da API atual: `docs/openclaw-financeiro-api.md`
- Tela atual: `app/admin/integracoes/page.tsx`
