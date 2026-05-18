# PRD — Camada de Cache (Dashboard, Relatório, IA-Análise)

**Status:** PR aberto — https://github.com/RodrigoNGP/Dashboard_NGP/pull/7
**Branch:** `feat/cache-layer`
**Data:** 2026-05-17
**Autor:** Arthur Oliveira (com assistência Claude)
**Stakeholders:** gestores NGP (operação diária), admin

---

## 1. Problema

Toda navegação no NGP Space dispara chamadas novas ao Meta Ads API e ao Google Ads API. Cada chamada Meta leva **1.5–4s**, pior em horários de pico. Em um dia típico de operação:

- ~20 clientes, ~5 ações por cliente, 3–7 requests Meta cada → **~300–700 chamadas/dia**
- 5 gestores abrindo o mesmo cliente = **5 chamadas idênticas** ao Meta
- Refresh involuntário, navegação entre tabs = dobra tudo

**Custo percebido pelo gestor:** dashboard que "carrega de pouco em pouco". Relatórios demoram a abrir. Snapshots IA recarregam mesmo quando já foram gerados.

**Custo real:** rate limits da Meta API, latência composta, tempo do gestor desperdiçado.

---

## 2. Objetivo

Reduzir latência percebida em **>70%** nas telas críticas (Dashboard overview, Relatório autoimport, IA-análise) **sem aumentar custo de infraestrutura**, e **sem retrabalho futuro** se um dia precisarmos escalar pra Redis.

### Métricas-alvo

| Métrica | Antes | Depois |
|---|---|---|
| Dashboard overview (20 clientes), 1ª visita | ~8s | ~2s |
| Dashboard overview, refresh subsequente | ~8s | <500ms |
| Reabrir relatório salvo | ~5s | instantâneo |
| Snapshot IA já carregado | ~3s | instantâneo |
| Chamadas Meta diárias (mesma org) | ~700 | ~150 |
| Hit rate global do cache | n/a | >60% após 1 semana |

---

## 3. Decisões arquiteturais

### 3.1 Por que NÃO Redis (ainda)

**Volume atual:** ~10 req/s pico. Postgres aguenta 50K/s sem suar. Adicionar Redis hoje seria:

- +1 sistema pra manter, monitorar, fazer backup
- Latência adicional de 50-200ms por conexão em edge functions serverless
- Custo recorrente (Upstash ~R$ 25-100/mês ou VPS gerenciada)
- Complexidade operacional sem ganho proporcional

**Quando faria sentido Redis:**

- Tráfego > 100 req/s constantes
- TTLs muito curtos (segundos)
- Real-time features (pubsub, contadores atômicos)
- Cache distribuído entre múltiplos servidores

Hoje não estamos lá. Schema da `api_cache` foi desenhado pra ser **substituível**: bastará trocar `withCache` para ler/escrever Redis sem mudar nenhum call site.

### 3.2 Arquitetura em 2 camadas

```
┌─────────────────────────────────────────────────────────┐
│  Camada 1: Frontend (browser)                           │
│  - Memória (Map global, sobrevive remount)              │
│  - localStorage (sobrevive F5)                          │
│  - TTL 30min default                                    │
│  - Dedup de in-flight requests                          │
│  - Bypass via "↻ Atualizar"                             │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼ (cache miss)
┌─────────────────────────────────────────────────────────┐
│  Camada 2: Postgres (api_cache)                         │
│  - Compartilhado entre todos os gestores                │
│  - TTL configurável por endpoint                        │
│  - GC diário via pg_cron                                │
│  - Stats agregados em cache_stats                       │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼ (cache miss)
                  ┌───────────────┐
                  │  Meta API     │
                  │  Google Ads   │
                  │  ai-generate  │
                  └───────────────┘
```

### 3.3 Estratégia de invalidação

| Trigger | Ação |
|---|---|
| TTL expira (30min default) | Próxima leitura busca fresh + reescreve |
| Gestor clica "↻ Atualizar" | `bypass: true` força fresh; cache local zerado |
| Gestor edita cliente (meta_account_id, google_ads_customer_id) | `invalidateMetaCache(accountId)` zera entradas daquele cliente |
| Logout / troca de usuário | `clearMetaCache()` + `clearAllCache()` |
| Nova análise IA gerada | `invalidateEfCache('ai-generate-analysis')` |
| pg_cron diário 04:00 UTC | DELETE entries expiradas há +1h |

### 3.4 TTLs

- **Default geral:** 30 minutos
- Dados muito voláteis (saldo de conta, status pause/active): **bypass sempre**
- Dados imutáveis dentro da janela (period.last_7d em 14:00): **30min OK**
- Dados que mudam só por ação do gestor (prompts IA): **30min + invalidação manual**

---

## 4. Implementação

### 4.1 Frontend (camada 1)

**Arquivos novos:**

- `lib/meta-cached.ts` — wrapper de `metaCall()` com cache + dedup + bypass
- `lib/api.ts` — adicionados `efCallCached` e `invalidateEfCache`
- `lib/use-api-cache.ts` — hook React genérico (sem dep externa, 50 linhas) pra uso futuro

**Padrão de uso:**

```typescript
// Antes
const data = await metaCall('insights', params, accountId)

// Depois
const data = await metaCallCached('insights', params, accountId, {
  ttlMs: 30 * 60 * 1000,   // default
  bypass: false,            // true quando usuário clica refresh
  persist: true,            // default — sobrevive F5
})
```

**Dedup automática:** 2 hooks com mesma key disparam 1 só fetch.

### 4.2 Backend (camada 2)

**Migrations:**

- `20260517210000_api_cache.sql`:
  - Tabela `public.api_cache` (cache_key PK, payload jsonb, expires_at)
  - Tabela `public.cache_stats` (endpoint PK, hits, misses, last_*_at, avg_payload_kb)
  - RPC atômica `cache_stats_record(endpoint, hit, payload_bytes)`
  - RLS habilitado, zero policies (só service_role acessa)

- `20260517210100_api_cache_gc_cron.sql`:
  - `pg_cron` diário às 04:00 UTC apaga entries vencidas há +1h
  - Fallback: se `pg_cron` não estiver disponível, falha silenciosamente

**Edge function helpers (`_shared/api_cache.ts`):**

```typescript
import { withCache, buildCacheKey } from '../_shared/api_cache.ts'

const data = await withCache(sb, {
  key: buildCacheKey('meta-insights', { accountId, period }),
  ttlSeconds: 30 * 60,
  endpoint: 'meta-insights',  // pra telemetria
  fetcher: async () => callMetaApi(...),
  bypass: req.headers.get('x-cache-bypass') === '1',
})
```

**Garantias:**

- Falha de cache NUNCA bloqueia a request (degrada pro fetcher direto)
- Hits/misses registrados em `cache_stats` via RPC (fire-and-forget)
- `invalidateByPrefix` permite invalidar grupos relacionados (ex: tudo de um cliente)

### 4.3 Telemetria

**Edge function `admin-cache-stats`** (role=admin):

Retorna:
- Sumário: hit_rate, total_hits, total_misses, active_entries, expired_entries
- Por endpoint: hits, misses, hit_rate, payload médio, último hit
- Top 10 keys ativas (com idade e tempo até expirar)
- GC manual via `?gc=1`

**Página `/admin/cache-stats`:**

- Cards de sumário (hit rate colorido por threshold)
- Tabela por endpoint
- Tabela top keys
- Botão "🗑 Limpar expirados" pra GC manual

### 4.4 Pontos integrados (neste PR)

| Tela | Mudança |
|---|---|
| Dashboard overview | `metaCall` → `metaCallCached` + paralelismo total (era chunk 4) + botão "↻ Atualizar" funcional |
| Relatório autoimport | `callMetaProxy` ganha cache inline em localStorage (TTL 30min) |
| IA-análise | 3 reads idempotentes cacheados: `analytics-snapshots/latest`, `ai-generate-analysis/list_prompts`, `ai-generate-analysis/history`. Invalidação após `generate` |

### 4.5 Pontos NÃO integrados ainda (próximo PR)

- Edge function `meta-proxy` envolvendo com `withCache`
- Edge function `google-ads-campaigns` envolvendo com `withCache`
- Edge function `analytics-snapshots` envolvendo com `withCache`
- Botão "↻ Atualizar" em IA-análise e Relatório

**Por que separei:** quero validar a camada 1 em HML antes de mexer nas edges. Camada 2 (Postgres) já está pronta pra ser usada; só precisa cabeamento nas edges.

---

## 5. Riscos e mitigações

### 5.1 Dado defasado

**Risco:** Gestor vê CPL antigo porque cache de 30min ainda não expirou, e cliente cobra "por que esse número?".

**Mitigação:**
- Botão "↻ Atualizar" visível em cada tela crítica
- TTL conservador (30min, não 1h)
- Em telas com dado muito sensível, manter `bypass: true`

### 5.2 Cache poisoning

**Risco:** Resposta com erro fica cacheada por engano, prejudicando próximos requests.

**Mitigação:**
- `efCallCached` **NÃO cacheia respostas com `error`** (verificação `if (!data || data.error) return data`)
- Migration RLS bloqueia escrita direta — só edges com service_role
- TTL curto limita janela de impacto

### 5.3 localStorage cheio

**Risco:** Safari modo privado / cota cheia faz `setItem` falhar.

**Mitigação:**
- Try/catch silencioso em todas as escritas localStorage
- Cache em memória continua funcionando mesmo sem persistência
- GC do localStorage no read (entries expiradas são removidas ao ler)

### 5.4 Vazamento entre gestores

**Risco:** Gestor A vê dados que gestor B só deveria ver (em multi-tenant).

**Mitigação:**
- Hoje NGP Space é mono-tenant (todos gestores veem todos os clientes da agência) — não é problema
- Cache key NÃO inclui `session_token` (varia por usuário, mas dado é o mesmo)
- Se um dia for multi-tenant, adicionar `org_id` na chave

### 5.5 pg_cron não disponível

**Risco:** Ambiente sem `pg_cron` (local dev, alguns planos Supabase) não roda GC.

**Mitigação:**
- Migration tem `DO $$ ... EXCEPTION WHEN OTHERS $$` — não bloqueia
- GC manual disponível em `/admin/cache-stats` (botão "🗑 Limpar expirados")
- `withCache` também faz GC oportunístico após escritas (próximo PR)

---

## 6. Test plan (pra HML)

### 6.1 Setup

- [ ] Aplicar migration `20260517210000_api_cache.sql`
- [ ] Aplicar migration `20260517210100_api_cache_gc_cron.sql`
- [ ] Deploy edge function `admin-cache-stats`
- [ ] Verificar que `pg_cron` está habilitado (extensão)

### 6.2 Smoke test funcional

- [ ] Abrir Dashboard com 20 clientes, medir tempo de carga inicial
- [ ] F5: segunda carga deve ser <500ms (cache localStorage)
- [ ] Clicar "↻ Atualizar": deve recarregar do Meta (~8s de novo)
- [ ] Trocar período: cache invalidado automaticamente, nova carga
- [ ] Logout + login com outro gestor: cache vazio, primeira carga lenta de novo

### 6.3 Relatórios

- [ ] Criar relatório novo (Meta-only): fluxo normal
- [ ] Reabrir o mesmo relatório (F5 ou tab nova): autoimport não chama Meta de novo (cache hit)
- [ ] Aguardar 30min, reabrir: chama de novo (TTL expirou)

### 6.4 IA-análise

- [ ] Abrir cliente, ver snapshot carregar
- [ ] Sair e voltar: snapshot vem instantâneo (cache hit)
- [ ] Gerar nova análise: history atualiza (invalidação após generate funcionou)

### 6.5 Telemetria

- [ ] Acessar `/admin/cache-stats` com user admin
- [ ] Verificar que `total_hits` e `total_misses` aparecem (após uso real)
- [ ] Clicar "🗑 Limpar expirados": confirma dialog, mostra contagem
- [ ] Endpoint não-admin: 403

### 6.6 Edge cases

- [ ] Safari modo privado: cache em memória funciona, localStorage falha silenciosa
- [ ] Sessão expirada durante request: cache não corrompe, fluxo normal de re-login
- [ ] 2 abas abertas chamando mesma key: dedup funciona (1 só fetch real)
- [ ] Refresh de página durante request em curso: cancela, próximo abre normal

---

## 7. Rollout

### Fase 1 — HML (esta semana)

1. Merge PR #7 em `develop` (que vai pra HML)
2. Aplicar migrations no projeto HML
3. Deploy edge `admin-cache-stats` em HML
4. Smoke test conforme seção 6
5. Monitorar `/admin/cache-stats` por 2-3 dias

### Fase 2 — Prod (próxima semana)

1. Merge `develop` → `main`
2. Aplicar migrations em prod
3. Deploy edge `admin-cache-stats` em prod
4. Monitorar hit rate por 1 semana
5. Comunicar gestores: botão "↻ Atualizar" se algum dado parecer velho

### Fase 3 — Edges Meta/Google com cache compartilhado (PR separado)

Quando camada 1 estiver provada em prod, integrar `withCache` nas edges `meta-proxy`, `google-ads-campaigns`, `analytics-snapshots`. Isso **multiplica o ganho**: gestor A esquenta cache, gestor B aproveita.

### Fase 4 — Roadmap (sem urgência)

- Migrar `_shared/api_cache.ts` pra Redis se algum dia volume justificar
- Adicionar `useApiCache` hook em mais telas
- Cache de detalhes de campanha (`adsets`, `ads`) com TTL menor (5min)

---

## 8. Métricas pós-launch (após 1 semana em prod)

Olhar em `/admin/cache-stats`:

- **Hit rate global ≥ 60%** → arquitetura funcionando
- **Hit rate < 30%** → TTLs muito curtos ou tráfego muito disperso, revisar
- **Entradas expiradas > 1000** → GC não rodando, investigar pg_cron
- **Endpoint com 0 hits e muitos misses** → key estourando uniqueness, revisar `buildCacheKey`

---

## 9. Decisões abertas / decisões tomadas

**Tomadas:**

- ✅ TTL padrão de 30min (sugerido por Arthur, equilibra freshness e hit rate)
- ✅ Botão "↻ Atualizar" em cada tela (sugerido por Arthur, máxima visibilidade)
- ✅ Cache em 2 camadas (frontend + Postgres) sem Redis
- ✅ pg_cron pra GC diário às 04 UTC

**Abertas (próxima sessão):**

- Quando integrar `withCache` nas edges Meta/Google?
- Adicionar hook `useApiCache` em PresentMode (apresentação ao cliente)?
- Cache de detalhes de campanha (adsets/ads) merece TTL menor?

---

## 10. Custo

- **Infra adicional:** R$ 0 (Supabase Pro já contratado, Postgres é grátis)
- **Tokens IA economizados:** estimado ~30-40% redução de chamadas a `ai-generate-analysis` (snapshots cacheados)
- **Tempo de gestor economizado:** ~5-10min/dia por gestor (estimativa conservadora, 20 cliques mais rápidos por dia)

---

## 11. Anexos

- PR: https://github.com/RodrigoNGP/Dashboard_NGP/pull/7
- Commit: `991dbbc`
- Branch: `feat/cache-layer`
- Arquivos criados:
  - `lib/meta-cached.ts`
  - `lib/use-api-cache.ts`
  - `supabase/functions/_shared/api_cache.ts`
  - `supabase/functions/admin-cache-stats/index.ts`
  - `app/admin/cache-stats/page.tsx`
  - `supabase/migrations/20260517210000_api_cache.sql`
  - `supabase/migrations/20260517210100_api_cache_gc_cron.sql`
- Arquivos modificados:
  - `lib/api.ts` (adicionados efCallCached + invalidateEfCache)
  - `app/dashboard/hooks/useDashboard.ts` (paralelismo + cache)
  - `app/dashboard/page.tsx` (botão refresh chama refreshOverview)
  - `app/ia-analise/page.tsx` (3 reads cacheados + invalidação)
  - `public/relatorio-static.html` (cache inline no callMetaProxy)
