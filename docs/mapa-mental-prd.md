# PRD — Setor de Brainstorm (Mapas Mentais)

**Status:** Proposta inicial — não implementado
**Branch sugerido:** `feat/mapa-mental`
**Data:** 2026-05-18
**Autor:** Arthur Oliveira (com assistência Claude)
**Stakeholders:** equipe interna NGP (gestores de tráfego, comercial, operação)

---

## 1. Problema

Hoje a NGP brainstorma e estrutura ideias em ferramentas externas (MindMeister, Miro, Notion, papel) e nenhuma delas está conectada ao NGP Space. Resultado:

- **Briefings de cliente** ficam em docs lineares que perdem o fio do raciocínio.
- **Brainstorms de campanha** (criativos, ofertas, ângulos, segmentações) acontecem em ferramentas que não conhecem o cliente — não puxam histórico, não viram tarefa, não viram ação no relatório.
- **Planejamento estratégico interno** (OKRs, processos, decisões) fica espalhado em chats e docs soltos.
- **Documentação de projetos morre** porque doc linear não acompanha a evolução do pensamento.

Falta um lugar dentro do NGP Space onde a equipe possa **pensar visualmente em árvore** — partindo de um nó central (cliente, projeto, problema) e ramificando ideias.

---

## 2. Objetivo

Entregar um **setor de Mapas Mentais** dentro do NGP Space, no estilo MindMeister (hierárquico/radial, com nó central e ramificações), que:

1. Funcione 100% dentro do sistema (sem dependência externa).
2. Esteja conectado aos dados existentes (clientes, campanhas, tarefas, copilot).
3. Permita à equipe interna criar, editar e organizar mapas com fluidez (drag, expand/collapse, atalhos de teclado).
4. Sirva como insumo para outras áreas — um mapa pode virar plano de campanha, tarefa, briefing, ou contexto pro NGP Copilot.

### Métricas-alvo (após 30 dias do lançamento)

| Métrica | Alvo |
|---|---|
| Mapas criados | ≥ 1 por gestor ativo |
| Mapas vinculados a um cliente | ≥ 60% do total |
| Tempo médio pra criar 10 nós | < 60s (com atalhos) |
| Mapas convertidos em tarefa/briefing | ≥ 20% |
| Reclamação de "ferramenta lenta" | 0 |

---

## 3. Escopo (v1)

### 3.1 Casos de uso cobertos

| Caso | Como o mapa entra |
|---|---|
| **Brainstorm de campanha por cliente** | Mapa vinculado a `clientes.id`. Nó central = cliente. Ramos: ofertas, criativos, públicos, ângulos. |
| **Planejamento estratégico interno** | Mapa "livre" (sem cliente). Usado pra OKRs, processos, decisões. |
| **Briefing visual com cliente** | Mapa interno, mas estruturado em formato de briefing (objetivo, público, dores, diferenciais). Cliente **não acessa** (v1). Equipe usa como insumo. |
| **Documentação viva de projetos** | Mapas que evoluem ao longo do tempo, vinculados a um projeto/iniciativa interna. |

### 3.2 Funcionalidades

**Editor de mapa**
- Canvas com nó central + ramos hierárquicos (pai → filhos → netos…).
- Adicionar nó: `Tab` (filho) e `Enter` (irmão) — atalhos MindMeister-style.
- Editar texto inline (duplo clique ou `F2`).
- Excluir nó: `Delete` (remove subárvore com confirmação).
- Mover subárvore: drag-and-drop pra outro pai.
- Expand/collapse: clique no nó pra esconder/mostrar filhos.
- Cores por ramo (paleta NGP — 6 cores fixas).
- Ícones opcionais por nó (Lucide — 12 ícones curados: 💡 ideia, ✅ ação, ❓ pergunta, 🎯 meta, etc).
- Notas longas: cada nó pode ter um texto longo anexo (markdown simples, abre em painel lateral).
- Zoom + pan no canvas.
- Auto-layout (botão "organizar") — recalcula posições em árvore radial.

**Gestão de mapas**
- Lista de mapas (`/mapas` ou `/brainstorm`) com busca por nome/cliente.
- Filtros: por cliente, por autor, por tag.
- Tags livres no mapa (ex: "campanha", "briefing", "okr").
- Vincular mapa a um cliente (dropdown na criação).
- Duplicar mapa (útil pra usar como template).
- Exportar: PNG (canvas inteiro) e Markdown (estrutura como lista aninhada).

**Conexões com o resto do NGP Space**
- **Cliente**: mapa pode estar vinculado a um cliente. Aparece numa aba do perfil do cliente.
- **Copilot**: botão "discutir esse mapa com o Copilot" — envia a estrutura serializada como contexto pra conversa.
- **Tarefas** (futuro, fora da v1): converter nó em tarefa.

### 3.3 Fora do escopo (v1)

- ❌ Modo canvas livre (Miro-style) — só árvore hierárquica.
- ❌ Colaboração em tempo real (múltiplos cursores). Edição é single-user; salva no Supabase a cada N segundos.
- ❌ Compartilhamento com cliente externo. Apenas equipe interna NGP.
- ❌ Versionamento/histórico de versões.
- ❌ Templates pré-prontos (vem na v2 se a demanda aparecer).
- ❌ IA gerando o mapa sozinha. v1 é manual; v2 pode ter "expandir esse nó com IA".

---

## 4. Decisões arquiteturais

### 4.1 Biblioteca de canvas: **React Flow** (já instalada)

O `package.json` já tem `reactflow ^11.11.4` em uso no `components/trackeamento/builder/FlowEditor.tsx` (builder de tracking). Reutilizar:

- Zero custo de bundle adicional.
- Equipe já tem familiaridade com a API.
- Suporta: nodes customizados, edges customizados, zoom/pan, fitView, minimap, controls.
- Performance ok pra mapas de até ~500 nós (limite mais que suficiente — mapas típicos terão 20–80).

**Por que não outras opções:**

- `react-mindmap` / `react-mind-map`: bibliotecas pequenas, manutenção fraca, menos flexíveis.
- `vis-network`: ótima pra grafos, mas pesada (~600kb) e estilização engessada.
- Construir do zero com SVG: caro, sem ganho.

### 4.2 Estrutura de dados

Cada mapa é uma **árvore** persistida em Postgres (Supabase). Não usamos tabela `edges` separada — a relação pai/filho fica no próprio nó (`parent_id`). Isso simplifica queries (`select * where map_id = X` traz tudo) e elimina inconsistências de aresta órfã.

```sql
-- Mapa (cabeçalho)
create table mapas_mentais (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  cliente_id uuid references clientes(id),     -- null = mapa livre
  titulo text not null,
  descricao text,
  tags text[] default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nós do mapa (incluindo o nó raiz)
create table mapas_mentais_nos (
  id uuid primary key default gen_random_uuid(),
  mapa_id uuid not null references mapas_mentais(id) on delete cascade,
  parent_id uuid references mapas_mentais_nos(id) on delete cascade,  -- null = raiz
  texto text not null,
  nota_md text,                                 -- nota longa opcional
  cor text,                                     -- '#hex' ou null (herda do pai)
  icone text,                                   -- nome do ícone Lucide ou null
  posicao_x float,                              -- só usado se auto-layout = off
  posicao_y float,
  ordem integer not null default 0,             -- ordem entre irmãos
  collapsed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_nos_mapa on mapas_mentais_nos(mapa_id);
create index idx_nos_parent on mapas_mentais_nos(parent_id);
create unique index uniq_raiz_por_mapa on mapas_mentais_nos(mapa_id) where parent_id is null;
```

**RLS:** mesma política dos outros recursos NGP — `org_id` deve bater com a org do usuário logado.

### 4.3 Estratégia de salvamento

- **Debounce de 1.5s** após qualquer edição → salva o nó alterado (não o mapa inteiro).
- Salva o **nó por nó** via `upsert` — não há "salvar mapa inteiro" pra evitar payloads grandes.
- Indicador visual no header: "salvando…" → "salvo às HH:MM".
- Em caso de falha de rede: fila local em memória, retry a cada 5s. Toast de aviso.
- **Não há lock de edição** — single-user na v1, então não precisa de OT/CRDT.

### 4.4 Layout: auto vs manual

- **Padrão: auto-layout radial** (algoritmo simples: pai no centro, filhos distribuídos em círculo, recursivo).
- Usuário pode arrastar nós livremente → vira "manual mode" para aquele mapa (flag por mapa, não por nó).
- Botão "reorganizar" sempre disponível pra voltar pro auto.

---

## 5. UX / Fluxo principal

### Tela `/mapas`

```
┌────────────────────────────────────────────────────────┐
│ Mapas Mentais                          [+ Novo mapa]   │
├────────────────────────────────────────────────────────┤
│ [Buscar...]  [Cliente ▾] [Tag ▾]  [Meus mapas ▾]      │
│                                                        │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│ │ Cliente │ │ Plano   │ │ Briefing│                   │
│ │ Acme    │ │ Q3 NGP  │ │ Beta    │                   │
│ │ 42 nós  │ │ 18 nós  │ │ 28 nós  │                   │
│ │ ontem   │ │ 3d atrás│ │ semana  │                   │
│ └─────────┘ └─────────┘ └─────────┘                   │
└────────────────────────────────────────────────────────┘
```

### Tela `/mapas/[id]`

```
┌────────────────────────────────────────────────────────┐
│ ← Voltar │ Briefing Cliente Acme │ salvo às 14:22     │
│ Cliente: Acme ▾  Tags: briefing, q3                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│            ┌─ Público                                  │
│            │   ├─ B2B                                  │
│            │   └─ Decisor: dono                        │
│   [ACME] ──┼─ Dores                                    │
│            │   └─ Lead caro                            │
│            └─ Ofertas                                  │
│                ├─ Trial 7d                             │
│                └─ Desconto anual                       │
│                                                        │
│         [+] [✎] [🎨] [📌] [💬 Copilot] [⬇ Export]   │
└────────────────────────────────────────────────────────┘
```

### Atalhos

| Tecla | Ação |
|---|---|
| `Tab` | Adicionar nó filho |
| `Enter` | Adicionar nó irmão |
| `F2` / duplo-clique | Editar texto |
| `Delete` | Excluir nó (com confirmação se tiver filhos) |
| `Espaço` | Expandir/recolher nó selecionado |
| `↑ ↓ ← →` | Navegar entre nós |
| `Cmd/Ctrl + Z` | Desfazer (último N=20) |

---

## 6. Plano de implementação

### Fase 1 — Fundação (1 sprint)

- Migração SQL (tabelas + RLS + índices).
- Rota `/mapas` com listagem básica (CRUD do cabeçalho).
- Rota `/mapas/[id]` com React Flow renderizando árvore (read-only).
- Endpoint Supabase para `get_mapa(id)` retornando mapa + nós.

### Fase 2 — Edição (1 sprint)

- Adicionar/editar/excluir nós com atalhos (Tab, Enter, F2, Delete).
- Salvamento debounced por nó.
- Auto-layout radial.
- Toast de "salvando/salvo".

### Fase 3 — Polimento (1 sprint)

- Cores, ícones, notas longas (painel lateral).
- Drag-and-drop pra mover subárvore.
- Expand/collapse.
- Export PNG e Markdown.
- Filtros e busca na listagem.

### Fase 4 — Integrações (1 sprint)

- Aba "Mapas" no perfil do cliente.
- Botão "discutir com Copilot" — serializa árvore como markdown e abre conversa.
- Vinculação opcional a `clientes.id` na criação.

### Fora desse plano (v2+)

- Conversão nó → tarefa.
- "Expandir nó com IA".
- Templates.
- Tempo real / multi-cursor.
- Compartilhamento com cliente externo.

---

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Mapa com 500+ nós ficar lento | Limitar a 500 nós por mapa (v1). Avisar no UI ao chegar perto. |
| Auto-layout ficar feio em árvores muito largas | Fallback pra layout horizontal (tipo organograma) quando árvore tem >50 nós por nível. |
| Usuário perder trabalho por falha de rede | Fila local + retry + indicador visual claro do estado de save. |
| Cair em feature creep (templates, IA, real-time) | PRD explicita o que está fora. Validar v1 antes de pensar em v2. |
| Conflito visual com `app/setores/` (bate-ponto) | Usar rota `/mapas` ou `/brainstorm`, **não** `/setores`. |

---

## 8. Decisões pendentes (precisam de input do Arthur antes da Fase 1)

1. **Nome do setor na sidebar**: "Mapas Mentais", "Brainstorm", "Mapas", outro?
2. **Ícone do menu** (Lucide): `Network`, `GitBranch`, `Workflow`, `Lightbulb`?
3. **Quem cria mapas?** Qualquer usuário da org, ou só gestor+admin?
4. **Limite por usuário/org?** Sem limite, ou cap pra evitar abuso?
5. **Mapas "livres" (sem cliente)** aparecem pra toda a equipe ou só pro autor?

---

## 9. Observações

- Reutilizar React Flow é a maior alavanca de velocidade aqui — economiza ~1 sprint vs construir do zero.
- O esquema de salvamento por nó (não por mapa) deixa o sistema pronto pra futuro tempo-real se um dia fizer sentido.
- Conexão com NGP Copilot é o diferencial competitivo: nenhum MindMeister/Miro tem um agente que conhece o cliente lendo o mapa.
