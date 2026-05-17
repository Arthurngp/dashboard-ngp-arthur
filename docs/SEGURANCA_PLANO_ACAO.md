# Plano de Ação — Segurança NGP Space

**Data da auditoria:** 2026-05-17
**Auditor:** Claude (auditoria estática + leitura de código)
**Escopo:** repositório `ngp-space`, edge functions Supabase, app Next.js, arquivos versionados, `.env`, CORS, sessões, headers, HTMLs legados.

---

## Sumário executivo

Há **1 vazamento crítico real** (OpenRouter API key versionada). Resto da postura é razoável (RLS habilitada, PBKDF2 + salt, validação webhook, sessões com expiração), mas faltam camadas defensivas em profundidade: **security headers do Next**, **CORS com fallback wildcard**, **token de sessão em sessionStorage (XSS-acessível)**, **rate-limit em memória**, **HTMLs legados versionados**, e **`security/` em iCloud** (gitignored mas exposto a sincronização lateral).

O ponto que não é problema, apesar de parecer: a chave `sb_publishable_…` espalhada em HTML/TSX é por design — Supabase substituiu o anon JWT por essa família de chaves justamente para ser exposta no cliente. O que protege é a RLS, que o time já trabalhou (várias migrations `rls_critico_fase*`).

---

## P0 — Imediato (24h)

### 1. Rotacionar chave OpenRouter vazada e remover `.openclaude-profile.json`

- **Arquivo:** `.openclaude-profile.json` (raiz do repo, versionado)
- **Chave vazada:** `OPENAI_API_KEY = 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` (OpenRouter)
- **Histórico:** presente em 2 commits — `4a1b195` (`feat: add ngp forms and financeiro modules`) e `0382e98` (`feat: atualizações no dashboard, setores e novos módulos`)
- **Risco:** se o repo for tornado público ou houver vazamento de acesso ao GitHub, qualquer um usa a chave para consumir saldo da conta OpenRouter.

**Ações (nesta ordem, hoje):**

1. Revogar a chave no painel do OpenRouter → criar nova.
2. Mover a nova chave para o gestor de secrets adequado (Supabase Secrets para edge functions, `.env.local` para Next dev, env vars do Netlify para Next prod).
3. `git rm --cached .openclaude-profile.json`
4. Adicionar ao `.gitignore`:
   ```
   .openclaude-profile.json
   ```
5. Commitar: `chore(sec): remove arquivo de credencial local do versionamento`.

**Verificação pós-fix:**
```bash
git ls-files | grep openclaude  # deve voltar vazio
git log --all -S "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" --oneline  # ok deixar, chave já estará revogada
```

> **Importante:** mesmo após o `git rm`, a chave continua no histórico. A revogação no OpenRouter é o que mata o risco — limpeza do histórico (P1.5) é cosmética/forense.

---

## P1 — Próxima sprint (7-14 dias)

### 1.5. Deletar edge function `login1` (legada e mais fraca)

- **Arquivo:** `supabase/functions/login1/index.ts`
- **Estado:** versão antiga do endpoint de login. Verificado contra `login/index.ts`:
  - CORS hardcoded `'*'` (não usa `_shared/cors.ts`)
  - **Sem rate limit** (a `login` tem 5 tentativas / 5 min)
  - Hash de senha sem PBKDF2 (provavelmente SHA-256 puro sem salt)
  - Sem validação de role
- **Quem chama:** `grep -rn login1` em `app/`, `lib/`, `public/`, `*.html` → **nenhum resultado**. Endpoint deploiado mas sem cliente atual.
- **Risco:** atacante pode bater diretamente em `https://<projeto>.supabase.co/functions/v1/login1` para tentar bypass dos controles da `login` (sem rate limit, hash antigo). Se hashes legados ainda existem no banco, é credential stuffing trivial.

**Ações:**

1. Confirmar (com Arthur) que nada chama `login1` — incluindo apps mobile, integrações n8n, scripts internos.
2. Remover do `supabase/functions/`:
   ```bash
   rm -rf supabase/functions/login1
   # remover do supabase.json também
   ```
3. Editar `supabase.json` removendo o entry `"slug": "login1"`.
4. Fazer deploy/cleanup das functions no Supabase (`supabase functions delete login1`).

**Verificação pós-fix:**
```bash
curl -i -X POST https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/login1 \
  -H "Content-Type: application/json" -d '{}'
# Esperado: 404 ou function-not-found
```

---

### 2. Security headers no `next.config.js`

- **Arquivo:** `next.config.js`
- **Estado atual:** não existe bloco `async headers()`. Sem CSP, sem HSTS, sem X-Frame-Options, sem Referrer-Policy, sem Permissions-Policy.
- **Risco:** clickjacking, MIME-sniffing, XSS sem mitigação, vazamento de Referer para terceiros.

**Ação:** adicionar `headers()` em `next.config.js` com:

```js
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      // CSP em Report-Only inicialmente — listar fontes externas (supabase, openai, fontes,
      // gtm/analytics se houver) e ajustar antes de promover para enforce
      { key: 'Content-Security-Policy-Report-Only', value:
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; " +
        "connect-src 'self' https://uqukfjtwsuffeunikiwz.supabase.co https://*.supabase.co https://api.openai.com; " +
        "frame-ancestors 'none';"
      },
    ],
  }]
}
```

> **Por que CSP é obrigatório e não opcional aqui:** o token de sessão vive em `sessionStorage` (P1 #5). Enquanto a migração para cookie HttpOnly não acontecer, CSP é a principal mitigação de XSS que protege esse token.

**Verificação pós-fix:**
```bash
curl -sI https://<dominio-prod>/ | grep -iE 'strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
```

---

### 3. Fechar fallback CORS wildcard nas edge functions

- **Arquivo:** `supabase/functions/_shared/cors.ts:27`
- **Problema:** se a env var `ALLOWED_ORIGINS` não estiver setada nas secrets do Supabase, o handler responde `Access-Control-Allow-Origin: *` — abrindo todas as edge functions para qualquer origem.
- **Risco:** site malicioso pode chamar edge functions diretamente do navegador da vítima.

**Ações:**

1. Confirmar (via dashboard Supabase ou MCP) se `ALLOWED_ORIGINS` está configurada para o projeto `uqukfjtwsuffeunikiwz`.
2. Se estiver: alterar `cors.ts` para **falhar fechado** quando a env não está setada (não retornar `*`):
   ```ts
   if (ALLOWED_ORIGINS.length === 0) {
     // Em produção sem whitelist é erro de configuração — não abrir geral.
     return { 'Access-Control-Allow-Origin': '', 'Vary': 'Origin' }
   }
   ```
3. Setar `ALLOWED_ORIGINS` com as URLs reais (Netlify prod, preview, localhost dev).

**Verificação pós-fix:**
```bash
curl -i -X OPTIONS https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/login \
  -H "Origin: https://atacante.com" -H "Access-Control-Request-Method: POST"
# Esperado: ACAO header vazio ou ausente
```

---

### 4. Limpar HTMLs legados versionados na raiz

- **Arquivos versionados na raiz:** `index.html`, `login.html`, `perfil.html`, `adsboard-dashboard.html`, `cliente-dashboard.html`, `ia-analise.html`, `relatorio.html`, `relatorio-v2.html`, `PROJECT.html`, `utm-builder.html`
- **Em `public/`:** `public/relatorio-static.html` (servido em prod pelo Next), `public/relatorio-static 2.html` (cópia acidental)
- **Não rastreados:** `components/Sidebar.module 2.css`, `components/WorkspaceTopbar.module 2.css`, `public/relatorio-static 2.html` (arquivos com sufixo "2" — duplicações criadas pelo iCloud).

**Problema duplo:**
1. **Os HTMLs raiz não são servidos pelo Next** (não estão em `public/`), mas continuam no repo poluindo a base e podem confundir auditores futuros. Vários têm lógica de auth antiga em JS inline com `sb_publishable_...` (não é leak — vide sumário — mas é superfície morta).
2. **`public/relatorio-static.html` ESTÁ sendo servido em prod** com lógica completa (auth, fetch para Supabase, render). Precisa ser auditado linha a linha ou substituído por rota Next.

**Ações:**

1. **HTMLs raiz:** mover para `archive/` ou deletar de vez (avaliar caso a caso — `PROJECT.html` parece doc legada do projeto).
2. **`public/relatorio-static.html`:** decidir se é mantido ou migrado para rota Next. Se mantido, auditar:
   - validação de sessão (linhas ~778-887 fazem fetch direto com `Bearer ${_sess}`)
   - se há XSS via parâmetros de URL
   - se headers de segurança aplicam (depende do servidor estático do Netlify)
3. **Arquivos "2":** deletar (são lixo do iCloud). Já tem 3 listados como untracked no git status.

**Verificação pós-fix:**
```bash
ls *.html public/*.html 2>/dev/null
git status | grep ' 2\.'  # não deve aparecer
```

---

### 5. Sessão custom em `sessionStorage` — endurecer

- **Arquivos:** `lib/auth.ts:18-58`, `lib/team-chat/notifications-provider.tsx:105`
- **Comportamento atual:** token de sessão (`adsboard_session`) é gravado em `sessionStorage`, acessível por qualquer JS rodando na página. Sem `HttpOnly`, sem `Secure`, sem `SameSite`.
- **Risco:** uma única falha de XSS (em qualquer ponto da app, inclusive em HTML legado servido) → atacante exfiltra o token e usa via `app/api/crm-contract-agent/route.ts` (que valida pela tabela `sessions`).

**Trade-off:** migrar para cookie HttpOnly exige rewrite do fluxo de login (`supabase/functions/login/index.ts`) e de todos os pontos que enviam `Bearer ${_sess}` manualmente — é P1 grande, talvez P2 dependendo de prioridade.

**Ações (escolher caminho):**

- **Caminho A (defesa em profundidade, menor reescrita):**
  - Reduzir TTL da sessão (hoje não está claro qual é o `expires_at` — checar `supabase/functions/login/index.ts`).
  - Adicionar rotação de token a cada N minutos (refresh).
  - Bloquear `<script>` inline em produção via CSP (item 2).
- **Caminho B (correção definitiva):**
  - Migrar token para cookie `HttpOnly; Secure; SameSite=Lax`.
  - Validar via middleware Next (`middleware.ts`) lendo o cookie.
  - Edge functions passam a aceitar o cookie via header `Cookie` + parse.

**Verificação pós-fix:**
```bash
# Cookie path
curl -i -c - https://<prod>/api/login -d '{"username":"x","password":"y"}'
# Deve mostrar Set-Cookie: adsboard_session=...; HttpOnly; Secure
```

---

### 6. Remover `console.log` que expõe parte do token

- **Arquivo:** `supabase/functions/whatsapp-webhook/index.ts:352`
- **Linha:** `console.log('[whatsapp-webhook] 401 - token recebido:', normalized?.slice(0, 8) + '...')`
- **Problema:** primeiros 8 caracteres do `WEBHOOK_SECRET_TOKEN` vão para o log do Supabase a cada tentativa falha. 8 caracteres ainda é entropia útil para um atacante em caso de log leak.

**Ação:** trocar por:
```ts
console.log('[whatsapp-webhook] 401 - tentativa de webhook não autorizada')
```

Mesma checagem em outros pontos:
- `supabase/functions/meta-proxy/index.ts:113` — `Fallback token search: found=${!!metaToken}` — só mostra boolean, OK.

---

### 6.5. Atualizar `xlsx` — CVE-2023-30533 (prototype pollution)

- **Arquivo:** `package.json` → `"xlsx": "^0.18.5"`
- **CVE:** [CVE-2023-30533](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) — prototype pollution, severidade alta. Afeta `xlsx < 0.20.2`.
- **Risco:** se algum endpoint que parseia planilhas (financeiro-import, ponto-import) aceita upload do usuário, atacante pode disparar prototype pollution → potencial RCE/DoS dependendo do uso.
- **Contexto extra:** SheetJS removeu o pacote do registry público após o CVE. A distribuição oficial agora é via CDN próprio.

**Ação:**

```bash
npm uninstall xlsx
# Opção A — versão oficial pós-CVE
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
# Opção B — migrar pra exceljs (mais ativo, registry npm normal)
# npm install exceljs && refatorar imports
```

**Verificação pós-fix:**
```bash
npm ls xlsx exceljs
npm audit --omit=dev | grep -i xlsx  # deve estar limpo
```

---

### 7. Limpeza do histórico git (após rotação da P0)

Mesmo com a chave OpenRouter revogada, ela continua no histórico em 2 commits. Se o repo for um dia tornado público (ou se a conta GitHub for comprometida), continua sendo má prática manter.

**Ação (depois que confirmar a P0 está feita):**

```bash
# Usar git-filter-repo (não filter-branch, deprecado)
brew install git-filter-repo
git filter-repo --invert-paths --path .openclaude-profile.json --force
# Reescreve histórico — todo mundo da equipe precisa re-clonar
git push --force-with-lease origin develop main
```

> Se houver outros colaboradores no repo, alinhar antes — força-push reescreve histórico e quebra clones existentes.

---

## P2 — Backlog (30-90 dias)

### 8. Rate limit em memória → Redis/KV/banco

- **Arquivo:** `supabase/functions/login/index.ts:7` (`attempts = new Map(...)`)
- **Problema:** edge functions Supabase podem rodar em múltiplas instâncias. O `Map` é por-instância — atacante distribuído (ou bem-sortudo no roteamento) burla o limite de 5 tentativas / 5 min.
- **Ação:** mover contador para tabela Postgres com TTL via `expires_at`, ou usar Upstash/Redis. Aplicar mesmo padrão em outras rotas sensíveis (`admin-criar-usuario`, `update-profile`).

### 9. Senha mínima de 6 caracteres é fraca

- **Arquivo:** `supabase/functions/admin-criar-usuario/index.ts:48`
- **Ação:** aumentar para ≥12 ou validar entropia (zxcvbn). Forçar troca em login de usuários atuais com senha curta.

### 10. Auditoria RLS table-by-table

- O time já fez várias `rls_critico_fase*` migrations. Verificar com `pg_policies` quais tabelas ainda têm RLS desligada ou policies abertas:
  ```sql
  SELECT schemaname, tablename, rowsecurity, hasrowsecurity, hasrules
  FROM pg_tables LEFT JOIN pg_class ON pg_class.relname = tablename
  WHERE schemaname = 'public' AND NOT relrowsecurity;

  SELECT * FROM pg_policies WHERE schemaname = 'public';
  ```
- Atenção especial: `usuarios`, `clientes`, `sessions`, `crm_*`, `financeiro_*`, `chat_*`, `relatorios`.

### 11. Logs de auditoria de ações sensíveis

- Criar tabela `audit_log` com (usuário, ação, target, IP, timestamp, payload_resumido).
- Disparar em: criação/edição/exclusão de usuário, alteração de role, exclusão de cliente/relatório/lead/transação financeira, login admin.

### 12. Pastas sensíveis em iCloud Drive

- **Estado:** `security/` e `historico-total-controlle-financeiro/` são gitignored (correto), mas o repo todo vive em `~/Library/Mobile Documents/com~apple~CloudDocs/...`. iCloud sincroniza esses arquivos para qualquer device logado na conta Apple.
- **Conteúdo:**
  - `security/`: `PENTEST_2026-05-09.md`, `PENTEST_FINAL_*.md`, `HISTORICO.md` — relatórios de pentest com detalhes de exploração e cadeias de ataque conhecidas.
  - `historico-total-controlle-financeiro/`: CSVs do Controlle e SQLs de import — **dados financeiros de clientes** (LGPD).
- **Risco:** se a conta iCloud for comprometida (phishing, vazamento de senha Apple ID), atacante baixa um roadmap pronto de como atacar o NGP Space **e** dados financeiros de clientes. Vazamento LGPD direto.
- **Ações:**
  - Mover ambas as pastas para fora do iCloud (ex.: `~/Documents/ngp-security/` e `~/Documents/ngp-financeiro-historico/` local apenas, ou repo privado separado).
  - Se precisar continuar no iCloud, criptografar (ex.: `age`, sparse bundle criptografado do macOS, ou 1Password).
  - Verificar se o `.git/` do repo também não vai para iCloud (`.git/objects/` pode conter blobs sensíveis se algum CSV foi commitado em algum momento).

### 13. Dependências e CVEs gerais

```bash
npm audit --omit=dev
```

Habilitar Dependabot ou Renovate.

### 14. `pdf-parse`, `mammoth` — input de cliente?

Verificar onde esses parsers são chamados e se aceitam upload sem validação de tamanho/tipo MIME — superfície clássica de DoS via arquivo grande/malformado.

### 15. Tipagem `@ts-nocheck` em edge functions

`supabase/functions/whatsapp-webhook/index.ts:1` tem `// @ts-nocheck`. Outros casos parecidos pelo projeto? Tipagem fraca em endpoints públicos aumenta chance de bugs com impacto de segurança (ex.: `payload.usuario_id` que deveria vir do servidor sendo aceito do request).

---

## Itens que NÃO são problema (anti-falso-positivo)

Documentado aqui para que ninguém abra issue/PR "removendo" no futuro:

- **`sb_publishable_8Be9xpxGtJDsM8AGtcDwmQ_Z_WPhYQ_` em HTML/TSX:** é a chave anon publicável do Supabase, **feita para ser exposta no client**. O que protege os dados é a RLS, não o segredo da chave.
- **`SUPABASE_SERVICE_ROLE_KEY` em `PROJECT.html:407`:** é apenas a string literal `sua_service_role_key` (placeholder de documentação), não a chave real.
- **`SUPABASE_SERVICE_ROLE_KEY` em `app/api/crm-contract-agent/route.ts:32`:** lido de `process.env`, executado server-side. Correto.
- **`.env.local` no gitignore:** está versionado o `.env.local.example`, que tem apenas a `NEXT_PUBLIC_SUPABASE_ANON` (publishable) + placeholders. OK.
- **RLS "vazia" em várias tabelas:** é intencional — o acesso é só via edge functions com `service_role`, que bypassa RLS. Migrations `rls_critico_fase1/2*` documentam o padrão.

---

## Inventário de superfície (referência rápida)

### Variáveis de ambiente reais (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL          → URL Supabase (pública)
NEXT_PUBLIC_SUPABASE_ANON         → chave publishable (pública)
EVOLUTION_API_URL                 → URL Evolution API
EVOLUTION_GLOBAL_KEY              → secret Evolution (server only)
WEBHOOK_SECRET_TOKEN              → secret webhook (server only)
OPENAI_API_KEY                    → secret OpenAI (server only)
OPENAI_MODEL                      → config (não secret)
DATABASE_PASSWORD                 → secret Postgres (server only)
NEXT_PUBLIC_INTERNAL_CHAT_ENABLED → flag (pública)
```

### Edge functions sensíveis (auth/admin)
- `login`, `login1`, `logout`, `refresh-session`
- `admin-criar-usuario`, `admin-update-usuario`, `admin-listar-usuarios`
- `admin-ponto-*` (8 funções)
- `admin-carreira-*` (8 funções)
- `cliente-portal-access`, `link-client-account`, `archive-cliente`

### API routes Next (server-side)
- `app/api/crm-warmup/route.ts` — só ping de OPTIONS, OK
- `app/api/crm-contract-agent/route.ts` — usa SERVICE_ROLE_KEY + cache de sessão
- `app/api/crm-contract-template-import/route.ts`
- `app/relatorio/route.ts`

### Webhooks expostos
- `supabase/functions/whatsapp-webhook` — valida `EVOLUTION_WEBHOOK_SECRET` ou `WEBHOOK_SECRET_TOKEN` ✓
- `supabase/functions/trackeamento-forms` — auditar (não foi olhado em detalhe)
- `supabase/functions/feedback-submit` — auditar

---

## Comandos de re-auditoria (rodar mensalmente)

```bash
# 1. Procurar novos secrets hardcoded
git grep -nE "sk-[a-zA-Z0-9_-]{20,}|sb_secret_|eyJ[A-Za-z0-9_-]{20,}\." \
  -- ':!*.lock' ':!node_modules' ':!.next'

# 2. Garantir que .env* não está versionado
git ls-files | grep -E '^\.env'  # só pode mostrar .env.local.example (ou nada)

# 3. Arquivos sensíveis novos
git ls-files | grep -iE '\.pem$|\.key$|service-account|credential|firebase-adminsdk'

# 4. Headers de segurança em prod
curl -sI https://<prod>/ | grep -iE 'strict-transport|x-frame|x-content-type|content-security|referrer-policy'

# 5. CORS fechado
curl -i -X OPTIONS https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1/login \
  -H "Origin: https://attacker.test"

# 6. npm audit
npm audit --omit=dev --audit-level=high
```

---

## Resumo priorizado (TL;DR)

| Prio | Item | Esforço | Impacto |
|------|------|---------|---------|
| P0 | Rotacionar chave OpenRouter + remover `.openclaude-profile.json` | 30min | Crítico |
| P1 | Deletar edge function `login1` (legada, sem rate limit) | 30min | Alto |
| P1 | Security headers Next (inclui CSP Report-Only) | 1-2h | Alto |
| P1 | CORS fail-closed nas edge functions | 30min | Alto |
| P1 | Atualizar `xlsx` — CVE-2023-30533 | 1-2h | Alto |
| P1 | Auditar/remover `public/relatorio-static.html` + HTMLs raiz | 2-4h | Médio |
| P1 | Cookie HttpOnly p/ sessão | 1-2 dias | Alto |
| P1 | Remover `console.log` do token webhook | 5min | Baixo |
| P1.5 | Limpar histórico git da chave vazada | 1h | Cosmético |
| P2 | Rate limit persistente | 4-8h | Médio |
| P2 | Senha mínima 12 chars | 1h + comunicação | Médio |
| P2 | Auditoria RLS completa | 1-2 dias | Alto |
| P2 | Audit log | 1-2 dias | Alto |
| P2 | Tirar `security/` e `historico-total-controlle-financeiro/` do iCloud | 30min | Alto (LGPD) |
| P2 | Dependabot + `npm audit` | 1h | Médio |
| P2 | Auditar parsers `pdf-parse`/`mammoth` (validação MIME/tamanho) | 2-3h | Médio |
| P2 | Remover `@ts-nocheck` das edge functions | 2-4h | Médio |
