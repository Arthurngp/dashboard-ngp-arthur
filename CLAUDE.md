# NGP Space — Instruções para IA (Claude Code / Cursor / outros)

> **LEITURA OBRIGATÓRIA NO INÍCIO DE TODA SESSÃO.** Antes de qualquer trabalho de código, leia o **vault Obsidian** deste projeto. Ele é a memória persistente e a fonte da verdade.

## Caminho do vault

```
/Users/arthuroliveira/Library/Mobile Documents/iCloud~md~obsidian/Documents/Arthur Eduardo Mendes de oliveira/NGP Space/
```

> Se você não está rodando nessa máquina, o vault está num iCloud Drive do Arthur — peça pra ele compartilhar o conteúdo relevante.

## Leitura obrigatória (toda sessão)

Antes de fazer qualquer coisa de código, leia **nesta ordem**:

1. **`NGP Space/REGRAS.md`** — Constitucional. Regras de stack, padrões, workflow, anti-padrões. Vence qualquer outra documentação em caso de conflito.
2. **`NGP Space/00-MOC.md`** — Índice mestre. Mostra o que existe documentado.

Depois, **sob demanda**, conforme a tarefa:

- Mexer em rota de `app/` → ler `NGP Space/03-Paginas/<nome>.md`
- Mexer em componente global → ler `NGP Space/04-Componentes/<nome>.md`
- Mexer em backend/Supabase → ler `NGP Space/05-Backend-Supabase/`
- Mexer em padrão visual → ler `NGP Space/09-Padrões-UX-UI/`
- Dúvida arquitetural → ler ADRs em `NGP Space/01-Arquitetura/`

## Regras de ouro

1. **Vault é fonte da verdade.** `docs/` no repo é espelho técnico.
2. **Não inventar.** Se não tem certeza de tabela/campo/rota/padrão, pergunte.
3. **Datas absolutas** (YYYY-MM-DD) em tudo.
4. **Toda feature exige plano de teste em `07-Testes/` ANTES de codar** (REGRAS.md §6).
5. **Mexer em padrão global** (Sidebar, Topbar, globals.css, cache, auth) **exige ADR** em `01-Arquitetura/`.
6. **Registrar débito técnico proativamente** em `11-Ajustes/` (REGRAS.md §8.1).
7. **Atualizar o vault** quando código mudar (REGRAS.md §8).
8. **NÃO comitar** sem pedido explícito do Arthur.

## Stack (resumo — detalhes no vault)

- Next.js 16 (App Router, `--webpack`)
- React 18 + TypeScript
- CSS Modules (sem Tailwind, sem CSS-in-JS)
- Supabase (Postgres + Auth + Edge Functions)
- Chart.js, ReactFlow, @dnd-kit, lucide-react

Mudar stack exige ADR. Não instalar lib nova sem registrar.

## Quem é o Arthur

Arthur Oliveira — fundador da NGP, Amplasoft e CopyAI. Este é o sistema interno da NGP. Ele é gestor/vendedor (não desenvolvedor profundo). Comunicação direta, sem rodeios, sem emojis. Quando você identificar débito técnico ou risco, **explique o impacto em linguagem clara** — não em jargão.

## Workflow padrão de toda feature

```
1. Conversa de escopo com Arthur
2. IA lê REGRAS.md + nota relevante do vault
3. IA cria/atualiza nota em 03-Paginas/ ou 04-Componentes/
4. IA cria plano de teste em 07-Testes/ (ANTES de codar)
5. Arthur revisa o plano
6. IA coda
7. IA roda o app (se Arthur pedir `npm run dev`) e valida
8. IA atualiza o vault (notas + 11-Ajustes/ se viu cheiro)
9. Arthur valida no navegador
10. Commit (só com pedido explícito)
```

Pular passos 3-5 é violação de regra.

## Convenções rápidas

- Tags úteis no vault: `#decisão`, `#feature`, `#bug`, `#risco`, `#padrão`, `#sessão`, `#ajuste`
- Links entre notas: `[[nome-da-nota]]`
- Referência a código: `path/arquivo.tsx:linha`
- Naming: snake_case em DB, camelCase em TS, PascalCase em componentes

## Em dúvida?

Perguntar é barato. Refatorar depois é caro. Quando não tiver certeza:
- Nome de tabela/coluna no Supabase
- Qual componente usar (CustomSelect vs nativo, etc)
- Padrão visual sem nota em `09-Padrões-UX-UI/`
- Onde uma feature nova deveria morar

→ Pergunte ao Arthur. Não chute.
