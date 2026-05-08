# PRD — IA Analista Financeira

**Status:** Aprovado conceitualmente, implementação adiada. Retomar quando o Arthur sinalizar.
**Data da especificação:** 2026-05-08
**Local da implementação:** rota `/financeiro/analista` (própria, dentro do guard `fin_auth_ok`).

---

## 1. Objetivo

Criar uma aba dedicada à análise inteligente do financeiro, posicionando a IA como o "melhor analista financeiro que o Arthur teria". Não é dashboard de KPIs — é um analista que **lê** os dados, **identifica** padrões/riscos/oportunidades, **prevê** faturamento e **aponta** ações.

## 2. Decisões já tomadas (com Arthur, em conversa de 2026-05-08)

| Decisão | Valor |
|---|---|
| Forma de uso | **Painel automático** (sem chat) |
| Conteúdos | **4 tópicos**: previsão, padrões/gargalos, lacunas, saúde financeira |
| Custo | **Médio — atualização sob demanda** ao clicar botão |
| Disparo | **Botão geral + botões individuais nos cards** |
| Localização | **Página própria `/financeiro/analista`** |
| Tom | "Melhor analista financeiro que eu teria" |

## 3. Achados pré-implementação (4 checks técnicos)

Foram rodados 4 checks no projeto antes de codar. Salvos aqui para a próxima sessão não precisar repetir.

### 3.1 Estado da edge function `financeiro-agent`
- **Existe e está completa**: 327 linhas, com `detectIntent`, `summarizeTotals`, `groupTopCategories`, `runAgent`, `fallbackResponse`
- **Modelo padrão**: `gpt-4o-mini` (configurável via env `FINANCEIRO_AGENT_MODEL`)
- **Tabela `fin_agent_runs`**: 0 linhas — função **nunca foi executada em produção**
- **Não tem nenhuma UI atual** que chame essa edge function (zero hits em `grep -rln "financeiro-agent" app/ components/`)

### 3.2 Snapshot atual da edge function (limitações)
- Limita a **500 transações** por chamada
- Janela só do **período passado** (não traz histórico)
- Não trabalha **assinaturas/recorrências**
- `max_output_tokens=1000` (pode cortar análise complexa)
- Schema único para 5 intents (`briefing/risks/forecast/cashflow/categorization`) → análise vira genérica

### 3.3 Custo real estimado
- **`gpt-4o-mini` ≈ $0.01/chamada** (não $0.05 como estimei na conversa)
- 4 chamadas paralelas no botão geral = **~$0.04/clique**
- 50 cliques/mês ≈ **$2/mês** (muito barato — pode até cair na ideia de "cron noturno" da fase 2 sem dor)

### 3.4 Schema do banco
- `fin_agent_runs` tem CHECK em `status` (`completed/fallback/error`) **mas não em `intent`** → posso adicionar valores `analista_*` livremente sem migration
- `OPENAI_API_KEY` configurada nas Edge Functions: **não confirmado** (já que `fin_agent_runs` está vazia). **Validar antes de implementar:** rodar uma chamada manual e ver se retorna `model=gpt-4o-mini` ou `null` no log

### 3.5 `analytics-contract.ts` (lib existente)
- Está focado em Meta Ads (campaigns, creatives, ROAS) — **não serve direto** para financeiro
- Mas o tipo `StructuredAnalysisResult` (headline, diagnosis, wins, risks, opportunities, nextActions, dataGaps, confidence) **é genérico** → reutilizar criando uma variação `FinanceiroAnalysisResult` em `lib/financeiro-analista.ts`

## 4. Arquitetura proposta

### 4.1 Estrutura de arquivos

```
app/financeiro/analista/
├── page.tsx                       (~400 linhas)
├── analista.module.css            (estilos próprios; reutiliza paleta financeiro)
└── components/
    ├── AnalystCard.tsx            (card de cada tópico, com botão ↻)
    ├── ConfidenceBadge.tsx        (high/medium/low)
    └── NextActionsList.tsx        (lista consolidada das ações)

lib/
└── financeiro-analista.ts         (types: PrevisaoResult, PadroesResult, LacunasResult, SaudeResult + parsers)

supabase/functions/financeiro-agent/
└── index.ts                       (estendido: adiciona switch por action no entrypoint)
```

### 4.2 4 actions na edge function

A edge atual tem `serve` direto sem switch por action. **Refatorar entrypoint** para rotear por `action` no payload (não é "adicionar 4 actions" — é uma pequena reescrita).

| Action | Snapshot necessário | Prompt foco | Schema saída |
|---|---|---|---|
| `analista_previsao` | Histórico 12m + assinaturas + pendentes futuros | "Projete o faturamento dos próximos 1-3 meses com base em padrões." | `{ projected_3m: number, monthly_breakdown: [...], drivers: string[], risks: string[], confidence }` |
| `analista_padroes` | Histórico 6m + agregações por dia/categoria/fornecedor | "Identifique tendências e gargalos: categorias que crescem, fornecedores caros, dia de mais saída." | `{ trends: [...], hotspots: [...], anomalies: [...], confidence }` |
| `analista_lacunas` | Queries SQL puras (não precisa OpenAI) | (não chama IA) | `{ missing_categoria: number, missing_contato: number, missing_cost_center: number, future_too_far: number, impact: string }` — gerado direto do banco |
| `analista_saude` | Saldo atual + queima mensal últimos 6m + margem | "Avalie saúde financeira: runway, taxa de queima, margem, comparativo histórico." | `{ runway_months: number, monthly_burn: number, margin: number, status: 'healthy/warning/critical', diagnosis }` |

**Atenção do advisor**: o card de **lacunas não precisa de IA** — é estatística pura. Passa por `execute_sql` direto no front, sem chamada OpenAI. Reduz custo geral para **3 chamadas IA** ($0.03/clique) e elimina latência de 1 chamada.

### 4.3 Cache / log
- Cada execução gravada em `fin_agent_runs` com `intent='analista_previsao'`, `analista_padroes`, `analista_saude`
- Ao abrir a página: carrega **última run de cada intent** do banco (sem chamar OpenAI)
- Botão "Atualizar" só dispara nova chamada quando clicado

### 4.4 UI

```
┌─ Header ──────────────────────────────────────────────┐
│ 🧠 Analista IA · Financeiro NGP                       │
│ Período: [Mês atual ▼]  [⚡ Atualizar análise completa]│
│ Última análise: há 2h                                 │
└────────────────────────────────────────────────────────┘

┌─ 🔮 Previsão ────────────┬─ 📊 Padrões e Gargalos ──┐
│ R$ 184k em 90 dias        │ Combustível +47% últimos │
│ confiança: alta           │ 3m. Dia 5 concentra 23%  │
│ [↻]                       │ das saídas. [↻]          │
├─ 🩹 Lacunas ─────────────┼─ ❤️ Saúde ───────────────┤
│ 410 sem categoria         │ Runway: 4.2 meses         │
│ 815 entradas sem cliente  │ Margem confirmada: 1.2%   │
│ [↻ recalcular]            │ Status: warning [↻]      │
└──────────────────────────┴──────────────────────────┘

📋 Próximas ações sugeridas (consolidado dos 4 cards)
  [HIGH] Categorizar 410 transações...
  [MED] Renegociar fornecedor X...
```

## 5. Riscos conhecidos

1. **Previsão fraca enquanto não houver assinaturas marcadas**
   Auditoria mostrou `assinatura_ativa=0` em todos os 106 clientes. A IA vai extrapolar do histórico, mas sem reconhecer mensalidades. Solução: **detector automático de recorrências** (clientes com cobrança mensal de valor parecido) + UI para Arthur confirmar.

2. **Contas-lixo distorcem análise**
   `NATHALLI R S SANTOS`, `NGP`, `5497380056655157` — todas com saldo muito negativo (cartões pessoais sem entradas correspondentes). Recomendação: arquivar essas contas antes da IA olhar, ou filtrar por padrão.

3. **Categorias com plano de contas inconsistente**
   `1.1 Receitas de vendas`, `1. Distribuição de Lucros`, `Combustíevel` (typo), categorias com prefixo numérico misturadas com livre. IA pode tratar duplicatas como categorias diferentes.

4. **Movimentação entre contas (1623 transações)**
   Inflam totais. DRE/Resumo já filtram via `isInternalTransferTransaction`. Cards do analista precisam fazer o mesmo.

## 6. Plano em etapas

| # | Etapa | Tempo aprox | Bloqueador |
|---|---|---|---|
| 1 | Validar OPENAI_API_KEY chamando edge function manualmente | 5min | — |
| 2 | Estender `financeiro-agent` com 4 actions + refatorar entrypoint | 30min | etapa 1 |
| 3 | Criar `lib/financeiro-analista.ts` com types e parsers | 15min | — |
| 4 | Criar `app/financeiro/analista/page.tsx` + componentes | 30min | — |
| 5 | Adicionar entrada "IA Analista" no `financeiroNav` | 5min | — |
| 6 | Deploy edge function + smoke test | — | depende de Arthur |
| 7 | Iterar prompts conforme qualidade percebida | iterativo | — |

## 7. Fase 2 — Ideias para depois

(O Arthur viu essas ideias na conversa e gostou. Não vão na primeira versão para evitar overscope.)

| Item | Descrição | Quando faz sentido |
|---|---|---|
| **Cron noturno** | Roda os 4 análises automaticamente às 6h da manhã. Ao abrir a aba, já vê análise fresca sem precisar clicar. | Depois da v1 estar estável e Arthur tiver hábito de usar |
| **Chat conversacional** | Pergunta livre tipo "quais clientes em risco de churn?" usando snapshot como contexto. | Depois que os cards mostrarem que a qualidade da análise IA está boa |
| **Ações executáveis pela IA** | "Marcar como conciliado", "categorizar em massa", "criar lembretes". Cada ação requer aprovação humana antes de executar. | Só depois de muita confiança na IA. Risco alto de mexer dados sem confirmação. |
| **Stream de tokens em tempo real** | Resposta da IA aparece sendo "digitada" como ChatGPT. | Só se a UX estática parecer fria — pequeno ganho de percepção, complexidade alta |
| **Detector de assinaturas recorrentes** | Script que olha histórico, detecta clientes que cobram mensal valor parecido, e apresenta lista para Arthur marcar como `assinatura_ativa=true`. | **Antes da v1 ficar pronta** — porque previsão depende disso. Mas pode ser um PR separado. |
| **Comparativo entre meses lado a lado** | Card "este mês vs mês anterior" com deltas em todas as métricas. | v2 — quando IA estiver gerando análise útil |
| **Alertas proativos** | E-mail/notificação quando IA detecta algo crítico (ex: queima >2x normal). | v3 — depois de calibrar o que é "crítico" |

## 8. Anexos / referências

- **Edge function existente**: `supabase/functions/financeiro-agent/index.ts` (327 linhas)
- **Tabela de log**: `fin_agent_runs` (vazia)
- **Auditoria de dados** que motivou os pontos da seção 5: ver mensagens da conversa de 2026-05-07 onde foi feita auditoria completa do banco financeiro pré-migração
- **PRD da migração Controlle** (relacionado): `historico-total-controlle-financeiro/PRD-migracao-controlle.md`

## 9. Quando retomar

Para a próxima sessão Claude que pegar isto:

1. **Releia este PRD inteiro** (não só o cabeçalho).
2. **Releia `supabase/functions/financeiro-agent/index.ts`** completo — pode ter mudado.
3. **Rode** `SELECT model, status, COUNT(*) FROM fin_agent_runs GROUP BY 1,2;` para ver se a edge já foi exercitada em produção (se sim, pular o teste manual de OPENAI_API_KEY).
4. **Confirme com Arthur** se ele ainda quer a fase 1 como descrita, ou se quer pular para algum item da fase 2.
5. **Não comece codando** — dê o panorama atualizado e peça aprovação.
