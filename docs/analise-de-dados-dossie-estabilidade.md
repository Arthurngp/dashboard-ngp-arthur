# Dossiê de Estabilização — Módulo Análise de Dados

**Data:** 2026-04-28
**Escopo:** dashboard, ia-analise, cliente analytics/relatórios, edge functions de analytics/AI/Meta, migrations relacionadas
**Objetivo:** estabilizar tudo ANTES de implementar IA preditiva, métricas personalizadas e mensagens recorrentes

---

## TL;DR

A queixa do "carrega de 4 em 4 e demora" é causada por **um único laço síncrono** em [app/dashboard/hooks/useDashboard.ts:231](app/dashboard/hooks/useDashboard.ts:231) que processa contas em chunks de 4 esperando cada chunk terminar antes do próximo. Com 20 contas isso vira 5 rodadas serializadas em vez de 1 paralela. **Fix de 1-2h reduz o tempo percebido de ~8s para ~2s.**

Mas há problemas mais graves dormindo embaixo: **RLS sem policies em tabelas críticas** (P0 segurança), **race conditions em troca rápida de cliente** (snapshot do cliente errado pode ser exibido), **history sem paginação** (vai estourar com 100+ análises), e **snapshot que sobrescreve em vez de versionar** — esse último é o **bloqueante #1 para IA preditiva**, porque sem série temporal histórica não há como treinar/inferir nada.

A boa notícia: a arquitetura está **agnóstica** o suficiente (meta-proxy genérico + snapshot em JSONB) para suportar métricas personalizadas com mudanças cirúrgicas. Não precisa reescrever nada — precisa **estabilizar, versionar séries temporais, e adicionar uma camada de "métricas computadas"**.

---

## Ordem de execução recomendada (faça nessa sequência)

A ordem importa. Não pule nem inverta — alguns fixes habilitam ou bloqueiam outros.

### **FASE 0 — Sangramento agudo (esta semana, 1-2 dias)**

São fixes pequenos com impacto enorme. Faça antes de qualquer feature nova.

1. **P0 perf** — Paralelizar o overview (4-em-4 → tudo de uma vez)
2. **P0 seg** — Adicionar RLS policies nas tabelas de analytics e AI
3. **P0 bug** — Remover `catch {}` silenciosos do useDashboard
4. **P1 bug** — Corrigir stale closure em loadLatestSnapshot (race de troca de cliente)

### **FASE 1 — Robustez (próxima semana, 3-5 dias)**

5. **P1 perf** — Eliminar N+1 em campanhas (lazy load adsets)
6. **P1 seg** — XSS no renderMarkdown próprio (trocar por DOMPurify ou react-markdown)
7. **P1 seg** — Whitelist no meta-proxy + remover token fallback anônimo
8. **P1 bug** — Paginação no history
9. **P1 bug** — AbortController + reset de analysisInFlight no finally

### **FASE 2 — Habilitar IA com segurança (2-3 semanas)**

10. **Versionar snapshots** (remover UPSERT que sobrescreve) — **bloqueante para IA preditiva**
11. **Tabela de métricas computadas** (`metric_definitions`) — habilita métricas personalizadas
12. **Job scheduler** (pg_cron ou edge agendada) — habilita análises recorrentes
13. **Rate limiting em ai-generate-analysis** — protege custo de tokens
14. **Cache de snapshot no frontend** (SWR ou Map em ref)

### **FASE 3 — Polish e expansão (depois, sem pressa)**

15. Code-split em ia-analise/page.tsx (787 linhas)
16. Breakdowns avançados do Meta (idade, gênero, plataforma, hora)
17. pgvector + RAG para análise contextual histórica
18. Webhook Meta em tempo real

---

## P0 — Críticos (resolver imediatamente)

### P0.1 — "Carrega de 4 em 4": waterfall de batches no overview

**Onde:** [app/dashboard/hooks/useDashboard.ts:231-237](app/dashboard/hooks/useDashboard.ts:231)

```js
const chunkSize = 4
for (let index = 0; index < orderedClients.length; index += chunkSize) {
  const batch = orderedClients.slice(index, index + chunkSize)
  const batchResults = await Promise.all(batch.map(loadClientOverview))
  rows.push(...batchResults)
  setOverviewRows([...rows])  // re-render a cada chunk
}
```

**Impacto:** com 20 contas = 5 rodadas serializadas. Tempo percebido ~8-10s. Cada `setOverviewRows` força re-render flashy.

**Fix recomendado:**
```js
const results = await Promise.allSettled(
  orderedClients.map(loadClientOverview)
)
const rows = results.map((r, i) =>
  r.status === 'fulfilled' ? r.value : fallbackRow(orderedClients[i], r.reason)
)
setOverviewRows(rows)  // 1 re-render só
```

**Tradeoff:** rate limit do Meta. Token de Business Manager aguenta ~25 paralelos tranquilamente; user token, menos. Se ultrapassar, voltar para chunk maior (10-12) com Promise.allSettled.

**Esforço:** 1-2h | **Ganho:** ~75% redução no tempo percebido

---

### P0.2 — RLS habilitado mas sem policies (BYPASS via service_role)

**Onde:** [supabase/migrations/20260414150000_ai_analysis.sql](supabase/migrations/20260414150000_ai_analysis.sql) e [20260426134500_analytics_snapshots.sql](supabase/migrations/20260426134500_analytics_snapshots.sql)

Tabelas com `ENABLE ROW LEVEL SECURITY` mas zero policies. Edge functions usam service_role key e **bypassam RLS por design**. Toda a autorização depende de checks no código TypeScript da edge function. Se um único `canAccessClient()` tiver bug, qualquer cliente pode ler análises/snapshots de qualquer outro (IDOR).

**Fix:**
```sql
-- analytics_snapshots
CREATE POLICY snapshot_owner_read ON analytics_snapshots
  FOR SELECT USING (created_by = auth.uid());

-- ai_analysis_runs
CREATE POLICY analysis_owner_read ON ai_analysis_runs
  FOR SELECT USING (created_by = auth.uid() OR cliente_id = auth.uid());

-- ai_prompt_templates (somente admins gerenciam, mas todos leem ativos)
CREATE POLICY prompts_read_active ON ai_prompt_templates
  FOR SELECT USING (is_active = true);
CREATE POLICY prompts_admin_write ON ai_prompt_templates
  FOR ALL USING (auth.jwt()->>'role' IN ('admin','ngp'));
```

E nas edge functions: usar **anon client com JWT do usuário** sempre que a operação não exige service_role. Reservar service_role só pra operações administrativas explícitas.

**Esforço:** M (4-6h, inclui testar cada fluxo)

---

### P0.3 — `catch {}` silencioso esconde falhas

**Onde:** [app/dashboard/hooks/useDashboard.ts:170, 301, 319, 338, 750](app/dashboard/hooks/useDashboard.ts)

```js
try { ... } catch {}  // erro de rede some, lista vazia, sem feedback
```

**Impacto:** Usuário vê dashboard vazio sem entender se carregou ou falhou. Sem retry. Bug fica invisível em produção.

**Fix:** sempre logar e setar `error`:
```js
try { ... } catch (err) {
  console.error('[useDashboard] loadClients failed', err)
  setError('Não foi possível carregar clientes. Tente recarregar.')
}
```

**Esforço:** S (1h)

---

### P0.4 — Race condition em troca rápida de cliente

**Onde:** [app/ia-analise/page.tsx:262-288](app/ia-analise/page.tsx:262)

`loadLatestSnapshot` tem deps `[]`. Se usuário troca cliente rapidamente, request 1 (cliente A, lento) pode chegar **depois** de request 2 (cliente B, rápido) e sobrescrever o snapshot exibido. Resultado: usuário vê dados do cliente A enquanto a UI mostra cliente B.

**Fix:** request counter + descartar respostas obsoletas:
```js
const reqIdRef = useRef(0)
const loadLatestSnapshot = useCallback(async (cid, username, account) => {
  const myReq = ++reqIdRef.current
  const data = await efCall(...)
  if (myReq !== reqIdRef.current) return  // resposta obsoleta
  setSnapshot(...)
}, [])
```

**Esforço:** S (1h)

---

## P1 — Altos (semana 1)

### P1.1 — N+1 em campanhas → adsets

**Onde:** [app/dashboard/hooks/useDashboard.ts:471](app/dashboard/hooks/useDashboard.ts:471)

`campaigns.forEach(c => loadAdsets(c.id, period))` dispara N requests em sequência. Com 50 campanhas → 50 chamadas Meta API (rate limit ~3 req/s = 17s só pra isso).

**Fix:** lazy load — só busca adsets quando o usuário clica para expandir a campanha. Ou paralelizar com `Promise.allSettled` se manter eager.

**Esforço:** M (2-3h)

---

### P1.2 — XSS via `dangerouslySetInnerHTML` + renderMarkdown caseiro

**Onde:** [app/ia-analise/page.tsx:70-83, 726, 774](app/ia-analise/page.tsx:70)

O `renderMarkdown` faz escape `&<>` antes das regex de bold/italic, mas o output da IA passa por `<li>...</li>` envolto em `<ul>` sem segundo passe de sanitização. Se a IA gerar (ou for induzida via prompt injection a gerar) `**<svg/onload=fetch(...)>**`, o conteúdo dentro do bold escapa o sanitizer.

Pior: o histórico armazena `output` no banco e re-renderiza depois — XSS persistente.

**Fix:**
- **Recomendado:** trocar por `react-markdown` com `rehype-sanitize`
- **Mínimo:** adicionar `DOMPurify.sanitize(html)` antes do `dangerouslySetInnerHTML`

**Esforço:** M (3-4h, incluindo testar histórico antigo)

---

### P1.3 — meta-proxy: SSRF latente + token fallback anônimo

**Onde:** [supabase/functions/meta-proxy/index.ts:66-114](supabase/functions/meta-proxy/index.ts:66)

1. `endpoint` é interpolado direto na URL — path traversal (`v19.0/../../debug/me`) não está bloqueado
2. Se token do usuário não for encontrado, fallback pega token de "qualquer NGP ativo" no banco. Sem auditoria de qual token foi usado, sem garantia de que esse NGP devia ter acesso à conta requisitada

**Fix:**
- Whitelist de endpoints permitidos (`['me', 'campaigns', 'adsets', 'ads', 'insights', ...]`)
- Validar com regex que não há `..` nem `//`
- Remover fallback anônimo: se token do usuário não existe, **falhar 401** em vez de pegar qualquer um
- Log estruturado: `{user_id, account_id, endpoint, token_owner_id}` (sem o token em si)

**Esforço:** M (3h)

---

### P1.4 — History sem paginação

**Onde:** [app/ia-analise/page.tsx:308-318, 760](app/ia-analise/page.tsx:308)

`action: 'history'` retorna **todas** as análises. Com 150 análises por cliente → JSON de MB, render de 150 `<details>`, possível timeout do supabase.

**Fix:** cursor-based pagination, 20 por página:
```ts
// edge function
.order('created_at', { ascending: false })
.limit(20)
.lt('created_at', cursor)  // se vier
```

Frontend: botão "Carregar mais" ou scroll infinito.

**Esforço:** M (3h)

---

### P1.5 — analysisInFlight ref nunca zera em `return` antecipado

**Onde:** [app/ia-analise/page.tsx:407-450](app/ia-analise/page.tsx:407)

Se `data.error` faz `return`, o `finally` executa (corrigindo no caso atual). Mas se houver throw síncrono antes do `try`, o ref fica travado e o usuário não consegue gerar nova análise. **Falta também AbortController** — se usuário fechar a página, setState dispara em componente desmontado.

**Fix:**
```ts
async function runAnalysis() {
  if (analysisInFlight.current) return
  const controller = new AbortController()
  analysisInFlight.current = true
  try {
    const data = await efCall(..., { signal: controller.signal })
    ...
  } finally {
    analysisInFlight.current = false
  }
}
useEffect(() => () => controller?.abort(), [])  // cleanup
```

**Esforço:** S (1h)

---

## P2 — Médios (sprint seguinte)

| # | Achado | Onde | Fix curto | Esforço |
|---|--------|------|-----------|---------|
| P2.1 | CORS fallback `*` em dev | `supabase/functions/_shared/cors.ts:25` | falhar se `ALLOWED_ORIGINS` vazio | S |
| P2.2 | Rate limit ausente em `ai-generate-analysis` | edge function | 5/h por user via Redis ou supabase counter | M |
| P2.3 | NaN em CTR/ROAS quando clicks=0 | [lib/analytics-snapshot.ts:155, 210](lib/analytics-snapshot.ts:155) | `value || 0` antes da divisão | S |
| P2.4 | Timezone bug em `fmtDate` | [app/ia-analise/page.tsx:56](app/ia-analise/page.tsx:56) | parsear com `T00:00:00Z` | S |
| P2.5 | Type assertion `as PromptTemplate[]` sem runtime check | [app/ia-analise/page.tsx:302](app/ia-analise/page.tsx:302) | Zod schema | S |
| P2.6 | Sem Error Boundary em volta da resposta IA | [app/ia-analise/page.tsx:726](app/ia-analise/page.tsx:726) | Error Boundary | S |
| P2.7 | Prompt injection no `extra_context` | [ai-generate-analysis/index.ts:268](supabase/functions/ai-generate-analysis/index.ts:268) | sanitize + prefixo "USER_INPUT_BEGIN/END" | S |
| P2.8 | Falta cache de snapshot no front | `useDashboard.ts` + `ia-analise/page.tsx` | useRef Map ou SWR | M |
| P2.9 | Bundle 787 linhas em ia-analise | [app/ia-analise/page.tsx](app/ia-analise/page.tsx) | quebrar em sub-componentes | S |
| P2.10 | Re-render por `setOverviewRows` no loop | [useDashboard.ts:237](app/dashboard/hooks/useDashboard.ts:237) | move pra fora | S (incluído no P0.1) |

---

## P3 — Baixos / técnicos

- Token Meta expirado (401) sem retry/refresh — [useDashboard.ts:194](app/dashboard/hooks/useDashboard.ts:194)
- `fetch` sem timeout em [lib/api.ts:49](lib/api.ts:49) (AbortController + setTimeout(15s))
- Migration `snapshot_id` adicionada via ALTER em vez de CREATE original — frágil mas funciona
- Índice composto otimizado pra upsert, não pra leitura por usuário/data — adicionar `idx_analytics_snapshots_user_period`
- Campos Meta unused (`cpc`, `action_values` quase sempre null) sendo pedidos — economia de banda

---

## Estabilidade pré-IA: bloqueantes específicos

Você quer adicionar **análise preditiva, mensagens recorrentes, IA contextual**. Aqui está o que **vai dar errado** se você implementar antes de resolver:

### 🔴 Bloqueante #1 — Snapshot sobrescreve histórico

[supabase/migrations/20260426134500_analytics_snapshots.sql](supabase/migrations/20260426134500_analytics_snapshots.sql) tem UNIQUE em `(created_by, source, meta_account_id, period_label)`. Toda regravação faz UPSERT. **Não existe série temporal**. Sem isso:

- Análise preditiva não tem dados pra treinar
- Não dá pra mostrar "evolução semanal" sem reconstruir do Meta a cada vez
- Mensagens recorrentes não têm baseline pra comparar

**Fix arquitetural:** trocar UPSERT por INSERT + adicionar `version int` ou apenas usar `(created_by, meta_account_id, period_label, generated_at)` como chave natural. Manter última versão "ativa" via flag `is_latest bool` ou view.

### 🔴 Bloqueante #2 — Sem job scheduler

Não há `pg_cron`, edge function agendada, nem fila. Para "mensagens recorrentes com análise" você vai precisar de:

- pg_cron rodando todo dia às 9h
- Edge function `ai-recurring-analysis` que itera clientes, gera snapshot, chama OpenAI, salva
- Tabela `recurring_analysis_subscriptions` (cliente + frequência + canal)
- Tabela `analysis_deliveries` (idempotência: já mandei essa análise pra esse cliente nessa data?)

### 🟡 Importante — Métricas hardcoded em TS

Métricas estão em `lib/meta-metrics.ts` e `lib/meta-analysis.ts` como código. Para "métricas personalizadas que o usuário cria" você precisa de:

```sql
CREATE TABLE metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  formula text NOT NULL,           -- ex: "{{revenue}} - {{spend}} - {{tax}}"
  variables jsonb NOT NULL,        -- ex: ["revenue","spend","tax"]
  format text NOT NULL,            -- 'currency'|'percent'|'ratio'|'count'
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, name)
);
```

E um avaliador seguro de fórmulas (não use `eval`! use uma lib tipo `expr-eval`).

### 🟢 Nice-to-have — pgvector + RAG

Para a IA "lembrar" do histórico do cliente em conversas recorrentes:
- Habilitar extensão `pgvector`
- `analytics_embeddings(snapshot_id, embedding vector(1536))`
- Edge function gera embedding do snapshot ao salvar

---

## Métricas personalizadas e Graph API: o que falta extrair

Hoje o `lib/meta-metrics.ts` consome:
- **Financeiro:** spend, ROAS, CPM, CPC
- **Volume:** impressions, clicks, reach, frequency, inline_link_clicks
- **Engajamento:** post/page engagement, video views (50%, 100%)
- **Conversões:** purchase, lead, add_to_cart, initiate_checkout, view_content, contact, search, messaging_conversation_started_7d

**Não consome (alto valor):**
- **Breakdowns:** age, gender, platform (FB/IG), placement (Feed/Stories/Reels), hourly, device_type, country
- **Atribuição:** versões 1d_click, 7d_click, 7d_view, 28d_click — fundamental pra entender qualidade do tráfego
- **Pacing:** daily_budget, lifetime_budget, % gasto vs % do tempo do flight
- **Audience insights:** custom_audiences, lookalike performance
- **Criativos:** thumbnail_url, video_id, body, title — já tem nos types mas não no snapshot

**Como adicionar uma métrica nova hoje** (mapeamento mecânico):
1. `lib/meta-metrics.ts` — append no array META_METRICS
2. `getRequiredApiFields()` — declarar dependência do campo Meta
3. `lib/meta-analysis.ts` — calcular em `buildTotals()` e `buildCampaignSummary()`
4. `lib/analytics-contract.ts` — estender `AnalyticsSnapshotSummary`
5. `lib/analytics-snapshot.ts` — popular em `buildAnalyticsSnapshot()`
6. `app/dashboard/hooks/useDashboard.ts` — normalizar em `normalizeOverviewMetrics()`

Esforço por métrica: ~30min. Mas **não escala** se você quer que o usuário crie. Daí o `metric_definitions` acima.

---

## Resumo: o que fazer já, esta semana

Se você só puder fazer **uma coisa** pra começar, faça [P0.1](#p01--carrega-de-4-em-4-waterfall-de-batches-no-overview) — paralelizar o overview. É 1-2h, ataca a queixa exata do usuário, e libera você psicologicamente pra atacar o resto.

Se puder fazer **um dia**, faça P0.1 + P0.2 + P0.3 + P0.4. Isso é o "bloco de sangramento agudo" e deixa a base sólida.

Se tiver **uma semana**, complete a Fase 1 inteira. Aí você está em condição de discutir IA preditiva.

Sobre **adicionar IA antes de estabilizar**: péssima ideia. Você vai empilhar features novas sobre RLS quebrado, races não tratadas, e snapshot que perde histórico. Cada feature de IA vai expor mais bugs e a depuração vira um pesadelo. Estabilize a base, depois construa em cima.
