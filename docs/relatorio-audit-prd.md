# PRD — Auditoria e Correções do Módulo de Relatórios

Data: 2026-05-13
Branch: `develop`
Autor da auditoria: Claude (Opus 4.7)
Escopo: rota `/relatorio`, editor estático (`public/logos/relatorio-static.html`), classificação de período, integração Meta e fluxos de entrada (Sidebar, Dashboard, Cliente).

---

## 1. Resumo executivo

O módulo de relatórios está **completamente quebrado em produção** desde o commit `0382e98` ("feat: atualizações no dashboard, setores e novos módulos", 27/04/2026). O arquivo HTML servido pela rota foi movido de `public/relatorio-static.html` para `public/logos/relatorio-static.html`, mas o handler `app/relatorio/route.ts` continuou apontando para o caminho antigo. Resultado: qualquer acesso a `/relatorio`, `/relatorio?novo=1` ou `/relatorio?id=...` lança `ENOENT` no `readFileSync` → resposta 500 → tela em branco.

A frase do usuário "não tem mais o botão de criar relatório, antes tinha" descreve esse sintoma: a página inteira não renderiza, então nenhum botão (incluindo "☁ Salvar", "👁 Prévia", "⬇ PDF" e a topbar com a navegação) aparece.

Aproveitando a janela de correção, foram identificadas falhas adicionais na **classificação automática do tipo de relatório** (Semanal/Quinzenal/Mensal) e no **conjunto de presets de período** (sem trimestre/semestre/ano), além de um bug sutil de cruzamento de ano no parser de datas.

---

## 2. Bugs identificados

### P0 — `/relatorio` retorna 500 (página totalmente fora do ar)

- **Arquivo**: `app/relatorio/route.ts:6`
- **Comportamento atual**:
  ```ts
  const html = readFileSync(join(process.cwd(), 'public', 'relatorio-static.html'), 'utf-8')
  ```
  Caminho real do arquivo: `public/logos/relatorio-static.html`.
- **Origem**: commit `0382e98` (move o arquivo sem atualizar o handler).
- **Impacto**:
  - Sidebar → "Relatórios" (`/relatorio?novo=1`) → 500.
  - Listagem do cliente → botão "Abrir →" em `ClienteAnalyticsView.tsx:291` (`/relatorio?id=…`) → 500.
  - Links já compartilhados de relatórios salvos na nuvem → 500.
- **Correção**: ajustar o `join(...)` para `'public', 'logos', 'relatorio-static.html'` **ou** mover o arquivo de volta para `public/relatorio-static.html`. Recomendação: **mover de volta**, porque o arquivo não pertence semanticamente à pasta `logos`. Esse caminho original já está consagrado em links externos compartilhados.

### P1 — `getTipoRelatorio` não cobre faixas comuns (Diário, Bimestral, Trimestral, Semestral, Anual)

- **Arquivo**: `public/logos/relatorio-static.html:1551-1571`
- **Lógica atual**:
  - vazio → "Semanal"
  - ≤ 7 dias → "Semanal"
  - 8 a 25 dias → "Quinzenal"
  - \> 25 dias → "Mensal"
- **Problema**: relatórios de 90 dias, 6 meses ou 1 ano todos aparecem rotulados como "Mensal" no header (`Relatório ${getTipoRelatorio(D.periodo)}`) e no preview (linha 1441). Comparações trimestrais/anuais ficam visualmente erradas.
- **Correção sugerida** (faixas em dias, redondas):
  - 0 dias (mesmo dia) → **Diário**
  - 2–6 → **Semanal**
  - 7 (exato) → **Semanal**
  - 8–17 → **Quinzenal**
  - 18–45 → **Mensal**
  - 46–75 → **Bimestral**
  - 76–135 → **Trimestral**
  - 136–225 → **Semestral**
  - 226+ → **Anual**
- **Decisão de UX**: quando `periodo` está vazio, exibir "—" (ou "Defina o período") em vez de "Semanal" silencioso. Caso o stakeholder prefira manter o default, deixar como "Personalizado".

### P1 — Presets do Meta Ads cobrem apenas até "Mês anterior"

- **Arquivo**: `public/logos/relatorio-static.html:1782-1790`
- **Atual**: Hoje, Ontem, 7d, 14d, 30d, Este mês, Mês anterior.
- **Faltam**: Este trimestre, Trimestre anterior, Este ano (YTD), Ano anterior, Personalizado já existe via `selectMetaCustom`.
- **Correção**: adicionar:
  ```js
  {label:'Este trimestre',  preset:'this_quarter'},
  {label:'Trim. ant.',      preset:'last_quarter'},
  {label:'Este ano',        preset:'this_year'},
  {label:'Ano anterior',    preset:'last_year'},
  ```
  Confirmar se a edge function `meta-proxy` já encaminha esses presets (Meta Marketing API aceita todos eles nativamente). Se filtra, ampliar a allow-list.

### P1 — Comparação `_compB.quick` só tem `week` e `month`

- **Arquivo**: `public/logos/relatorio-static.html:1810-2024`, função `resolveCompB`.
- **Problema**: usuário não consegue comparar trimestre vs trimestre, ano vs ano em um clique.
- **Correção**: adicionar atalhos `quarter` e `year` em `setCompB_quick` e `resolveCompB` mapeando para `last_quarter` e `last_year`.

### P2 — `parseData` calcula período errado quando cruza o ano

- **Arquivo**: `public/logos/relatorio-static.html:1556-1566`
- **Problema**: `parseData('15/01')` assume ano corrente. Para um período "20/12 a 10/01" digitado em janeiro, a primeira data vira `15/12/2026` (futuro) em vez de `15/12/2025`. O cálculo `Math.abs(d2-d1)` mascara o erro de ano mas o número de dias fica imprevisível.
- **Correção**: se `d2 < d1` e ambos tiveram ano omitido, recuar `d1.year -= 1`.

### P2 — Período é input livre de texto (`DD/MM a DD/MM`)

- **Arquivo**: `public/logos/relatorio-static.html:1290`
- **Problema**: usuário pode digitar formato inválido e a classificação cai silenciosamente em "Semanal". Já existe componente `components/CustomDatePicker.tsx`. Como o relatório é HTML estático isolado, não dá para importar React diretamente; alternativa: incluir um seletor nativo (`<input type="date">` × 2) ao lado do input atual, que ao mudar preencha `D.periodo` no formato canônico.

### P2 — Quando `?id=` é inválido, relatório fica preso em estado vazio

- **Arquivo**: `public/logos/relatorio-static.html:652-677`
- **Comportamento**: `loadFromCloud` mostra `alert('Relatório não encontrado')` e o editor segue carregado com `D` default. Sem botão de "voltar" ou "criar novo" visível.
- **Correção**: após o alert, redirecionar para `/relatorio?novo=1` ou exibir tela com CTA "Criar novo relatório".

### P3 — Sem listagem de relatórios para o gestor

- **Contexto**: cliente vê seus relatórios em `ClienteAnalyticsView` (linhas 277-298). NGP/gestor entra no editor sempre em modo `?novo=1` — não há tela para listar, abrir ou apagar relatórios já criados.
- **Recomendação futura**: criar `/relatorio/lista` (ou modal acionado por novo item de sidebar "Relatórios salvos") consultando `relatorios` no Supabase com filtros por cliente/data. Fora do escopo desta correção, mas registrado.

---

## 3. Plano de implementação

### Fase 1 — Hotfix P0 (≤ 5 min, deploy imediato)

1. Mover `public/logos/relatorio-static.html` → `public/relatorio-static.html` (preserva URL original e mantém o `route.ts` correto).
2. Smoke test local: `npm run dev`, abrir `/relatorio?novo=1`, verificar que carrega editor.
3. Commit: `fix(relatorio): restaura caminho do html servido pela rota`.

### Fase 2 — Correções P1 (1-2h)

4. Editar `getTipoRelatorio` em `public/relatorio-static.html`:
   - Trocar a tabela de faixas conforme seção 2.
   - Quando vazio, retornar `'Personalizado'` (ou string vazia conforme decisão de UX).
5. Adicionar presets `this_quarter`, `last_quarter`, `this_year`, `last_year` em `META_PERIODS`.
6. Adicionar atalhos `quarter` e `year` em `setCompB_quick` + `resolveCompB`. Atualizar `renderCompSlotB` para renderizar os novos botões.
7. Verificar `supabase/functions/meta-proxy` (ou equivalente): garantir que presets novos passam intactos para `date_preset` da Meta Marketing API.
8. Commit: `feat(relatorio): tipo dinâmico cobre diário/bimestral/trimestral/semestral/anual; novos presets Meta`.

### Fase 3 — P2 (1-2h)

9. Patch em `parseData` para corrigir cruzamento de ano (lógica: `if (d2 < d1) d1.year -= 1`).
10. Adicionar 2 `<input type="date">` opcionais ao lado do campo "Período"; ao mudar, formatar `DD/MM/AAAA a DD/MM/AAAA` no `D.periodo`.
11. `loadFromCloud`: quando 404, redirecionar para `/relatorio?novo=1` em vez de só fechar o alert.
12. Commit: `fix(relatorio): parseData cross-year, date picker nativo, fallback de id inválido`.

### Fase 4 — Validação

13. Casos de teste manual:
    - `/relatorio` (sem query) → carrega editor vazio, header "Relatório Personalizado".
    - `/relatorio?novo=1` → carrega editor vazio.
    - `/relatorio?id=<uuid existente>` → carrega relatório salvo.
    - `/relatorio?id=invalido` → redireciona para novo.
    - Período "01/05/2026 a 31/05/2026" → "Mensal".
    - Período "01/01/2026 a 31/03/2026" → "Trimestral".
    - Período "01/01/2026 a 31/12/2026" → "Anual".
    - Período "20/12/2025 a 10/01/2026" → ~22 dias, "Quinzenal" (não "Mensal" como hoje).
    - Importar dados Meta com preset "Trim. ant." → preenche relatório.
    - Comparação A=Este trimestre / B=Trim. ant. → preenche tabela comparativa.

### Fase 5 — Backlog (não bloqueia o release)

14. Tela `/relatorio/lista` para o gestor com listagem, busca, filtros e CTA "Novo relatório". Esse "Novo relatório" seria o equivalente literal do botão que o usuário sentiu falta — vale criá-lo mesmo que hoje o sidebar já abra direto no editor.
15. Migrar o editor de `relatorio-static.html` para um componente React de fato (próximo trimestre), para ganhar reuso, type-safety e testes.

---

## 4. Riscos e mitigações

- **Mover o HTML pode quebrar caches/CDN do Netlify**: forçar invalidação após deploy. Como o consumo é via rota Next (`route.ts`), Netlify não cacheia diretamente o HTML; risco baixo.
- **Edge function `meta-proxy` pode rejeitar presets novos**: validar antes de habilitar UI; cair para `custom` com from/until calculados se a API recusar.
- **Mudança de defaults visuais ("Semanal" → "Personalizado")**: confirmar com stakeholder antes do deploy. Sugestão: manter "Semanal" como fallback **apenas no preview impresso** e mostrar "—" no editor enquanto vazio.

---

## 5. Critérios de aceite

- [ ] Acessar `/relatorio?novo=1` carrega o editor sem erro.
- [ ] Acessar `/relatorio?id=<uuid existente>` carrega o relatório salvo.
- [ ] Tipo de relatório no header reflete corretamente Diário / Semanal / Quinzenal / Mensal / Bimestral / Trimestral / Semestral / Anual conforme dias do período.
- [ ] Modal de importação Meta lista pelo menos: Hoje, Ontem, 7d, 14d, 30d, Este mês, Mês ant., Este trimestre, Trim. ant., Este ano, Ano anterior, Personalizado.
- [ ] Comparação Meta A vs B oferece atalhos semana, mês, trimestre e ano.
- [ ] Período cruzando ano (ex.: 20/12 a 10/01) calcula o número correto de dias.
- [ ] Link compartilhado com `id` inválido leva o usuário a uma tela útil, não a uma página em branco.

---

## 6. Referências de código

| Item | Arquivo | Linha |
|------|---------|-------|
| Handler da rota | `app/relatorio/route.ts` | 6 |
| HTML do editor | `public/logos/relatorio-static.html` | — |
| Topbar com botões Salvar/Prévia/PDF | `public/logos/relatorio-static.html` | 1260-1276 |
| `getTipoRelatorio` | `public/logos/relatorio-static.html` | 1551-1571 |
| `META_PERIODS` | `public/logos/relatorio-static.html` | 1782-1790 |
| `_compB` / `resolveCompB` | `public/logos/relatorio-static.html` | 1810-1811, 2018-2024 |
| `parseData` | `public/logos/relatorio-static.html` | 1556-1566 |
| `loadFromCloud` | `public/logos/relatorio-static.html` | 652-677 |
| Sidebar — item Relatórios | `components/Sidebar.tsx` | 251-252 |
| Listagem cliente | `app/cliente/ClienteAnalyticsView.tsx` | 277-298 |
| Commit que quebrou | `0382e98` | — |
