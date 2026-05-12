'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { getSession } from '@/lib/auth'
import { SETOR_BOXES } from '@/lib/api-scopes'
import styles from './api-docs.module.css'

const BASE_URL = 'https://uqukfjtwsuffeunikiwz.supabase.co/functions/v1'
const ANON     = 'sb_publishable_8Be9xpxGtJDsM8AGtcDwmQ_Z_WPhYQ_'

interface Section { id: string; label: string; sub?: { id: string; label: string }[] }

const SECTIONS: Section[] = [
  { id: 'overview',    label: 'Visão geral' },
  { id: 'como-funciona', label: 'Como funciona' },
  { id: 'passos',      label: 'Passo a passo' },
  { id: 'auth',        label: 'Autenticação' },
  { id: 'scopes',      label: 'Permissões (scopes)' },
  {
    id: 'feedback',    label: 'API: Feedbacks',
    sub: [
      { id: 'feedback-list',   label: 'list' },
      { id: 'feedback-get',    label: 'get' },
      { id: 'feedback-update', label: 'update_status' },
      { id: 'feedback-answer', label: 'answer' },
    ],
  },
  {
    id: 'financeiro',  label: 'API: Financeiro',
    sub: [
      { id: 'financeiro-overview', label: 'Visão' },
      { id: 'financeiro-link',     label: 'Documentação completa' },
    ],
  },
  { id: 'erros',       label: 'Erros comuns' },
  { id: 'recipes',     label: 'Receitas práticas' },
  { id: 'changelog',   label: 'Changelog' },
]

function CopyButton({ value }: { value: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      className={`${styles.copyBtn} ${ok ? styles.copyBtnOk : ''}`}
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500) } catch {}
      }}
    >
      {ok ? '✓ Copiado' : 'Copiar'}
    </button>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div style={{ position: 'relative' }}>
      <pre className={styles.codeBlock}>{children}</pre>
      <CopyButton value={children} />
    </div>
  )
}

function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function ApiDocsPage() {
  const router = useRouter()
  const [sess, setSess] = useState<ReturnType<typeof getSession> | null>(null)

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'admin') { router.replace('/setores'); return }
    setSess(s)
  }, [router])

  if (!sess) return null

  return (
    <div className={styles.layout}>
      <Sidebar showDashboardNav={false} minimal />
      <main className={styles.main}>
        <div className={styles.shell}>

          {/* TOC */}
          <aside className={styles.toc}>
            <div className={styles.tocTitle}>Nesta página</div>
            <div className={styles.tocList}>
              {SECTIONS.map(sec => (
                <span key={sec.id}>
                  <button className={styles.tocItem} onClick={() => scrollToId(sec.id)}>
                    {sec.label}
                  </button>
                  {sec.sub?.map(s => (
                    <button key={s.id} className={`${styles.tocItem} ${styles.tocSub}`} onClick={() => scrollToId(s.id)}>
                      ↳ {s.label}
                    </button>
                  ))}
                </span>
              ))}
            </div>
          </aside>

          {/* Conteúdo */}
          <div className={styles.content}>
            <button className={styles.btnBack} onClick={() => router.push('/setores')}>← Setores</button>

            <header>
              <div className={styles.eyebrow}>Admin · Documentação técnica</div>
              <h1 className={styles.title}>API do NGP Space</h1>
              <p className={styles.lead}>
                Endpoints HTTP para conectar agentes externos (OpenClaw, automações, scripts internos) ao NGP Space.
                Tokens são gerados em <strong>Admin → Integrações</strong> e autenticam cada chamada por <em>scope</em>.
              </p>
            </header>

            {/* Visão geral */}
            <section id="overview" className={styles.section}>
              <h2 className={styles.sectionH2}>Visão geral</h2>
              <p className={styles.sectionP}>
                A API é composta por um conjunto de Edge Functions servidas em <code>https://&lt;projeto&gt;.supabase.co/functions/v1/&lt;funcao&gt;</code>.
                Hoje há dois grupos disponíveis: <strong>Feedbacks</strong> (bugs/erros/sugestões dos usuários) e <strong>Financeiro</strong> (contas, lançamentos, relatórios).
                Outros setores (Comercial, Pessoas, Tarefas) aparecerão à medida que ganharem endpoint dedicado.
              </p>
              <div className={styles.callout + ' ' + styles.calloutInfo}>
                <div className={styles.calloutIcon}>ℹ</div>
                <div className={styles.calloutBody}>
                  Toda chamada usa <strong>POST</strong> com <code>Content-Type: application/json</code>. A ação a executar vai no campo <code>action</code> do body —
                  isso permite uma URL estável por API e versionamento por ação.
                </div>
              </div>
            </section>

            {/* Como funciona */}
            <section id="como-funciona" className={styles.section}>
              <h2 className={styles.sectionH2}>Como funciona</h2>
              <p className={styles.sectionP}>
                Cada token (<code>ngp_live_...</code>) carrega uma lista de <em>scopes</em> que definem o que ele pode fazer. A Edge Function valida o token,
                checa o scope necessário para a ação solicitada e executa a operação no banco usando a chave service role do projeto.
                O usuário final nunca expõe sessão nem credenciais; o agente só conhece o token.
              </p>
              <p className={styles.sectionP}>
                Tokens podem expirar (5/15/30/60/90/180/365 dias ou nunca) e podem ser <strong>revogados</strong> a qualquer momento — uma vez revogado,
                qualquer chamada subsequente recebe <code>401</code>.
              </p>
            </section>

            {/* Passo a passo */}
            <section id="passos" className={styles.section}>
              <h2 className={styles.sectionH2}>Passo a passo para começar</h2>
              <ol className={styles.steps}>
                <li className={styles.step}>
                  <div className={styles.stepNumber}>1</div>
                  <div className={styles.stepBody}>
                    <div className={styles.stepTitle}>Acesse Admin → Integrações</div>
                    <div className={styles.stepDesc}>
                      Como admin, abra <code>/admin/integracoes</code>. Você verá as boxes por setor e a lista de tokens já cadastrados.
                    </div>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepNumber}>2</div>
                  <div className={styles.stepBody}>
                    <div className={styles.stepTitle}>Dê um nome ao token e escolha a expiração</div>
                    <div className={styles.stepDesc}>
                      Use um nome descritivo (ex.: <code>OpenClaw Feedback Bot</code>). Para agentes externos prefira um prazo definido (15–30 dias)
                      e renove periodicamente; só use "sem expiração" para integrações internas que você controla.
                    </div>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepNumber}>3</div>
                  <div className={styles.stepBody}>
                    <div className={styles.stepTitle}>Marque os setores e ações que o agente precisa</div>
                    <div className={styles.stepDesc}>
                      Cada box tem um toggle "básico" (geralmente leitura) ligado por padrão. Ações delicadas como <code>Atualizar status</code>
                      vêm desligadas — só ative se o agente realmente precisa. Permissões de alta sensibilidade exigem confirmação extra.
                    </div>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepNumber}>4</div>
                  <div className={styles.stepBody}>
                    <div className={styles.stepTitle}>Clique em "Gerar token" e copie imediatamente</div>
                    <div className={styles.stepDesc}>
                      O token completo é mostrado <strong>uma única vez</strong>. Depois disso só ficam o prefixo e o hash no banco. Cole em um cofre de segredos
                      (1Password, Doppler, .env local) antes de fechar a tela.
                    </div>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepNumber}>5</div>
                  <div className={styles.stepBody}>
                    <div className={styles.stepTitle}>Configure o agente para enviar nos headers</div>
                    <div className={styles.stepDesc}>
                      Use <code>x-ngp-api-token: ngp_live_...</code> (preferencial) ou <code>Authorization: Bearer ngp_live_...</code>. O header
                      <code>apikey</code> com a publishable key também é aceito pela infra Supabase.
                    </div>
                  </div>
                </li>
                <li className={styles.step}>
                  <div className={styles.stepNumber}>6</div>
                  <div className={styles.stepBody}>
                    <div className={styles.stepTitle}>Teste com a primeira chamada</div>
                    <div className={styles.stepDesc}>
                      Use <code>{`{ "action": "list", "limit": 1 }`}</code> em qualquer endpoint para validar autenticação. Resposta <code>200</code>
                      com <code>feedbacks: []</code> ou similar significa que está OK.
                    </div>
                  </div>
                </li>
              </ol>
            </section>

            {/* Autenticação */}
            <section id="auth" className={styles.section}>
              <h2 className={styles.sectionH2}>Autenticação</h2>
              <p className={styles.sectionP}>
                A Edge Function lê o token de duas formas (em ordem de prioridade):
              </p>
              <CodeBlock>{`# Forma recomendada (não conflita com JWT do Supabase)
x-ngp-api-token: ngp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Alternativa
Authorization: Bearer ngp_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Sempre necessário também (header padrão Supabase):
apikey: ` + ANON}</CodeBlock>
              <div className={styles.callout + ' ' + styles.calloutWarn}>
                <div className={styles.calloutIcon}>⚠</div>
                <div className={styles.calloutBody}>
                  <strong>Nunca</strong> envie o token <code>ngp_live_...</code> em URLs ou query string — ele aparece em logs do servidor e proxies. Use sempre header.
                </div>
              </div>
            </section>

            {/* Scopes */}
            <section id="scopes" className={styles.section}>
              <h2 className={styles.sectionH2}>Permissões (scopes)</h2>
              <p className={styles.sectionP}>
                Cada scope segue o formato <code>&lt;setor&gt;:&lt;acao&gt;</code>. As ações usam um vocabulário fechado:
                <code>read</code>, <code>create</code>, <code>update</code>, <code>delete</code>, <code>reports</code> (ou verbos específicos quando o domínio pede).
              </p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Scope</th><th>Setor</th><th>Descrição</th><th>Sensibilidade</th></tr>
                  </thead>
                  <tbody>
                    {SETOR_BOXES.filter(b => b.status === 'disponivel').flatMap(box => [
                      ...box.basico.scopes.map(scope => ({
                        scope, setor: box.label, desc: box.basico.description, sens: box.basico.sensibilidade,
                      })),
                      ...box.acoesDelicadas.map(a => ({
                        scope: a.id, setor: box.label, desc: a.description, sens: a.sensibilidade,
                      })),
                    ]).map(row => (
                      <tr key={row.scope}>
                        <td>{row.scope}</td>
                        <td className={styles.descCol}>{row.setor}</td>
                        <td className={styles.descCol}>{row.desc}</td>
                        <td>
                          <span className={`${styles.badge} ${row.sens === 'alta' ? styles.badgeDelete : row.sens === 'media' ? styles.badgeUpdate : styles.badgeRead}`}>
                            {row.sens === 'baixa' ? 'Baixa' : row.sens === 'media' ? 'Média' : 'Alta'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* API Feedbacks */}
            <section id="feedback" className={styles.section}>
              <h2 className={styles.sectionH2}>API: Feedbacks</h2>
              <p className={styles.sectionP}>
                Endpoint pensado para um agente externo varrer feedbacks novos pela manhã, identificar bugs e atualizar o status conforme resolve.
              </p>

              <div className={styles.endpoint}>
                <div className={styles.endpointHead}>
                  <span className={styles.method}>POST</span>
                  <span className={styles.endpointPath}>{BASE_URL}/feedback-api</span>
                </div>
                <p className={styles.endpointDesc}>Endpoint único — a ação vai no body em <code>action</code>.</p>
              </div>

              {/* list */}
              <h3 id="feedback-list" className={styles.sectionH3}>action: list <span className={`${styles.badge} ${styles.badgeRead}`}>feedback:read</span></h3>
              <p className={styles.sectionP}>Lista feedbacks ordenados do mais recente. Aceita filtros opcionais.</p>
              <CodeBlock>{`{
  "action": "list",
  "status": "novo",          // novo | em_andamento | resolvido | descartado (opcional)
  "tipo": "bug",             // bug | erro | sugestao | duvida | outro (opcional)
  "prioridade": "alta",      // baixa | media | alta | critica (opcional)
  "since": "2026-05-01",     // ISO 8601 (opcional)
  "limit": 50                // máx 200 (default 50)
}`}</CodeBlock>
              <p className={styles.sectionP}>Resposta:</p>
              <CodeBlock>{`{
  "feedbacks": [
    {
      "id": "f1c4...",
      "created_at": "2026-05-09T01:55:00Z",
      "updated_at": "2026-05-09T01:55:00Z",
      "usuario_nome": "Arthur Oliveira",
      "usuario_role": "admin",
      "titulo": "Adicionar cartão no financeiro",
      "tipo": "bug",
      "prioridade": "alta",
      "mensagem": "Desbloquear adicionar cartão...",
      "pagina_url": "/financeiro/cartoes",
      "screenshot_url": "https://.../feedback-screenshots/...",
      "status": "novo",
      "resposta_admin": null
    }
  ],
  "count": 1
}`}</CodeBlock>

              {/* get */}
              <h3 id="feedback-get" className={styles.sectionH3}>action: get <span className={`${styles.badge} ${styles.badgeRead}`}>feedback:read</span></h3>
              <p className={styles.sectionP}>Retorna um feedback específico, incluindo <code>user_agent</code> e <code>usuario_id</code> (não retornados em <code>list</code>).</p>
              <CodeBlock>{`{ "action": "get", "id": "f1c4..." }`}</CodeBlock>

              {/* update_status */}
              <h3 id="feedback-update" className={styles.sectionH3}>action: update_status <span className={`${styles.badge} ${styles.badgeUpdate}`}>feedback:update</span></h3>
              <p className={styles.sectionP}>
                Move o feedback entre status. Quando o agente resolve um bug, normalmente vai para <code>resolvido</code> com uma resposta interna.
              </p>
              <CodeBlock>{`{
  "action": "update_status",
  "id": "f1c4...",
  "status": "resolvido",
  "resposta_admin": "Corrigido em produção pelo OpenClaw em 2026-05-09 (commit abc123)."
}`}</CodeBlock>

              {/* answer */}
              <h3 id="feedback-answer" className={styles.sectionH3}>action: answer <span className={`${styles.badge} ${styles.badgeUpdate}`}>feedback:update</span></h3>
              <p className={styles.sectionP}>
                Apenas escreve na <code>resposta_admin</code> sem mudar status. Útil para enriquecer com contexto antes de decidir resolver.
              </p>
              <CodeBlock>{`{
  "action": "answer",
  "id": "f1c4...",
  "resposta_admin": "Reproduzi o bug no Chrome. Investigando."
}`}</CodeBlock>
            </section>

            {/* API Financeiro */}
            <section id="financeiro" className={styles.section}>
              <h2 className={styles.sectionH2}>API: Financeiro</h2>
              <h3 id="financeiro-overview" className={styles.sectionH3}>Visão</h3>
              <p className={styles.sectionP}>
                Endpoint <code>{BASE_URL}/financeiro-openclaw</code>. Permite listar contas, listar categorias, criar lançamentos e consultar relatórios
                (briefing diário, resumo semanal). Voltado para o agente registrar entradas/saídas e responder perguntas sobre o caixa.
              </p>
              <div className={styles.endpoint}>
                <div className={styles.endpointHead}>
                  <span className={styles.method}>POST</span>
                  <span className={styles.endpointPath}>{BASE_URL}/financeiro-openclaw</span>
                </div>
                <p className={styles.endpointDesc}>
                  Ações disponíveis: <code>listar_contas</code>, <code>listar_categorias</code>, <code>criar_lancamento</code>, <code>briefing_diario</code>, <code>resumo_semanal</code>.
                </p>
              </div>

              <h3 id="financeiro-link" className={styles.sectionH3}>Documentação completa</h3>
              <p className={styles.sectionP}>
                Schemas de cada ação (campos obrigatórios e opcionais), exemplos de body e respostas estão em
                <code> docs/openclaw-financeiro-api.md </code> no repositório. Esta página vai absorver esse conteúdo numa próxima iteração.
              </p>
            </section>

            {/* Erros */}
            <section id="erros" className={styles.section}>
              <h2 className={styles.sectionH2}>Erros comuns</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>HTTP</th><th>Body</th><th>Causa provável</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>401</td>
                      <td className={styles.descCol}><code>{`{ "error": "Token inválido ou expirado." }`}</code></td>
                      <td className={styles.descCol}>Token não enviado, com prefix incorreto, expirado ou revogado.</td>
                    </tr>
                    <tr>
                      <td>403</td>
                      <td className={styles.descCol}><code>{`{ "error": "Token sem permissão feedback:update." }`}</code></td>
                      <td className={styles.descCol}>Token autenticado mas sem o scope necessário para a ação. Reabra Integrações e marque o toggle correspondente.</td>
                    </tr>
                    <tr>
                      <td>400</td>
                      <td className={styles.descCol}><code>{`{ "error": "id é obrigatório." }`}</code></td>
                      <td className={styles.descCol}>Body inválido — campo obrigatório faltando ou enum fora do conjunto permitido.</td>
                    </tr>
                    <tr>
                      <td>404</td>
                      <td className={styles.descCol}><code>{`{ "error": "Feedback não encontrado." }`}</code></td>
                      <td className={styles.descCol}>O <code>id</code> existe na sua memória mas não no banco (talvez um descartado removido manualmente).</td>
                    </tr>
                    <tr>
                      <td>500</td>
                      <td className={styles.descCol}><code>{`{ "error": "..." }`}</code></td>
                      <td className={styles.descCol}>Erro interno. Cheque os logs em Supabase → Edge Functions → logs da função correspondente.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Recipes */}
            <section id="recipes" className={styles.section}>
              <h2 className={styles.sectionH2}>Receitas práticas</h2>

              <h3 className={styles.sectionH3}>Varredura matinal de bugs novos (Node.js)</h3>
              <CodeBlock>{`const TOKEN = process.env.NGP_API_TOKEN;
const ANON  = process.env.NGP_ANON_KEY;
const URL   = '${BASE_URL}/feedback-api';

const HEADERS = {
  'Content-Type': 'application/json',
  'apikey': ANON,
  'x-ngp-api-token': TOKEN,
};

async function fetchBugsNovos() {
  const r = await fetch(URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ action: 'list', status: 'novo', tipo: 'bug', limit: 50 }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data.feedbacks;
}

async function marcarResolvido(id, nota) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      action: 'update_status',
      id,
      status: 'resolvido',
      resposta_admin: nota,
    }),
  });
  return await r.json();
}

const bugs = await fetchBugsNovos();
console.log(\`Encontrados \${bugs.length} bugs em aberto.\`);`}</CodeBlock>

              <h3 className={styles.sectionH3}>Curl rápido (sanity check)</h3>
              <CodeBlock>{`curl -X POST '${BASE_URL}/feedback-api' \\
  -H 'Content-Type: application/json' \\
  -H 'apikey: ${ANON}' \\
  -H 'x-ngp-api-token: ngp_live_xxxxxxxxxxxxxxxx' \\
  -d '{"action":"list","limit":1}'`}</CodeBlock>

              <h3 className={styles.sectionH3}>Listar só feedbacks de prioridade alta dos últimos 7 dias</h3>
              <CodeBlock>{`{
  "action": "list",
  "prioridade": "alta",
  "since": "2026-05-02",
  "limit": 100
}`}</CodeBlock>
            </section>

            {/* Changelog */}
            <section id="changelog" className={styles.section}>
              <h2 className={styles.sectionH2}>Changelog</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Data</th><th>Mudança</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>2026-05-09</td>
                      <td className={styles.descCol}>
                        Adicionado <code>feedback-api</code> com actions <code>list / get / update_status / answer</code>.
                        Scopes <code>feedback:read</code> e <code>feedback:update</code> disponíveis em Integrações.
                        UI de tokens reorganizada em boxes por setor.
                      </td>
                    </tr>
                    <tr>
                      <td>2026-04-04</td>
                      <td className={styles.descCol}>
                        Lançado <code>financeiro-openclaw</code> com scopes <code>financeiro:read / create / reports</code>.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

          </div>
        </div>
      </main>
    </div>
  )
}
