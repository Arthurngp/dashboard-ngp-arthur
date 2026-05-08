'use client'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SURL } from '@/lib/constants'
import { efHeaders } from '@/lib/api'
import { fetchWithRetry } from '@/lib/fetch-utils'
import Sidebar from '@/components/Sidebar'
import NGPLoading from '@/components/NGPLoading'
import FinanceiroAuthModal from '@/components/FinanceiroAuthModal'
import { financeiroNav } from '../financeiro-nav'
import { fmtBRL } from '@/lib/financeiro-analista'
import styles from './dre.module.css'

type ViewMode = 'competencia' | 'caixa'

interface CellValue { valor: number; confirmado: number; pendente: number }

interface Cascata {
  receita_operacional: CellValue
  deducoes: CellValue
  receita_liquida: number
  custo_variavel: CellValue
  lucro_bruto: number
  despesa_comercial: CellValue
  despesa_administrativa: CellValue
  despesa_pessoal: CellValue
  despesa_outras: CellValue
  total_despesas_op: number
  lucro_operacional: number
  receita_financeira: CellValue
  despesa_financeira: CellValue
  outras_receitas: CellValue
  resultado_financeiro: number
  lucro_antes_ir: number
  imposto_lucro: CellValue
  prolabore_dividendos: CellValue
  resultado_final: number
}

interface DreData {
  ano: number
  mes: number | null
  periodo_label: string
  view: ViewMode
  cascata: Cascata
  margens: { bruta: number; operacional: number; liquida: number }
  total_transacoes: number
}

const MESES_LABEL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

interface CategoriaItem {
  id: string
  nome: string
  tipo: 'entrada' | 'saida'
  grupo_dre: string | null
  total: number
  count: number
}

const GRUPOS_LABEL: Record<string, string> = {
  receita_operacional: 'Receita operacional',
  deducao_receita: 'Dedução de receita',
  custo_variavel: 'Custo variável',
  despesa_comercial: 'Despesa comercial / marketing',
  despesa_administrativa: 'Despesa administrativa',
  despesa_pessoal: 'Despesa com pessoal',
  despesa_outras: 'Outras despesas operacionais',
  receita_financeira: 'Receita financeira',
  despesa_financeira: 'Despesa financeira',
  outras_receitas: 'Outras receitas (não operacional)',
  prolabore_dividendos: 'Pró-labore / dividendos',
  imposto_lucro: 'Imposto sobre o lucro (IR/CSLL)',
  transferencia: 'Transferência entre contas',
  ignorar: 'Ignorar',
}

const GRUPOS_ORDEM = [
  'receita_operacional', 'outras_receitas', 'receita_financeira',
  'deducao_receita', 'custo_variavel',
  'despesa_comercial', 'despesa_administrativa', 'despesa_pessoal', 'despesa_outras',
  'despesa_financeira', 'prolabore_dividendos', 'imposto_lucro',
  'transferencia', 'ignorar',
]

const HINTS: Record<string, string> = {
  receita_operacional: 'Tudo que entrou porque você prestou serviço, vendeu produto. NÃO inclui empréstimo, transferência interna, juros recebidos.',
  deducoes: 'Impostos que saem direto da venda (Simples, ISS), devoluções, descontos.',
  receita_liquida: 'Receita - Deduções. É o que efetivamente sobrou da venda.',
  custo_variavel: 'Custo de FAZER o que você vendeu (CMV/CSP). Sobe e desce com vendas: comissão de parceiro, mídia revendida, terceirizado que entrega.',
  lucro_bruto: 'Receita líquida - Custos variáveis. Aqui você vê se sua margem por venda é saudável.',
  despesa_operacional: 'Custos para manter a empresa funcionando, vendendo ou não. Aluguel, software, equipe interna.',
  lucro_operacional: 'Lucro bruto - Despesas operacionais. É o lucro do negócio em si. Negativo = problema estrutural.',
  resultado_financeiro: 'Juros recebidos e pagos, taxas bancárias, IOF. Coisa de banco fora do core do negócio.',
  prolabore: 'O que os sócios tiram da empresa. Distribuição de lucros, pró-labore.',
  imposto_lucro: 'IR e CSLL — imposto sobre o lucro da empresa.',
  resultado_final: 'O que sobrou da empresa depois de tudo. Esse é o lucro líquido.',
}

function pctOf(parte: number, total: number): string {
  if (!total || total === 0) return '0%'
  return `${((parte / total) * 100).toFixed(1)}%`
}

function DreInner() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const [view, setView] = useState<ViewMode>('competencia')
  const [ano, setAno] = useState<number>(new Date().getFullYear())
  const [mes, setMes] = useState<number | null>(null) // null = ano todo
  const [data, setData] = useState<DreData | null>(null)
  const [loading, setLoading] = useState(false)
  const [showClassifier, setShowClassifier] = useState(false)
  const [categorias, setCategorias] = useState<CategoriaItem[]>([])
  const [loadingCats, setLoadingCats] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  function showMsg(type: 'ok' | 'err', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  const callFn = useCallback(async (body: object) => {
    const s = getSession()
    if (!s) return { error: 'Sessão expirada.' }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetchWithRetry(
        `${SURL}/functions/v1/financeiro-agent`,
        { method: 'POST', headers: efHeaders(), body: JSON.stringify({ session_token: s.session, ...body }), signal: controller.signal, cache: 'no-store' },
        2,
      )
      const text = await res.text()
      let resp: any = null
      try { resp = text ? JSON.parse(text) : null } catch { return { error: `Resposta inválida (${res.status}).` } }
      if (!resp) return { error: res.ok ? 'Servidor não respondeu.' : `Erro ${res.status}.` }
      if (!res.ok && !resp?.error) return { error: `Erro do servidor (${res.status}).` }
      return resp
    } catch (e: any) {
      if (e?.name === 'AbortError') return { error: 'Cancelado.' }
      return { error: 'Erro de conexão.' }
    }
  }, [])

  useEffect(() => {
    const s = getSession()
    if (!s || s.auth !== '1') { router.replace('/login'); return }
    if (s.role !== 'ngp' && s.role !== 'admin') { router.replace('/setores'); return }
    const flag = sessionStorage.getItem('fin_auth_ok')
    if (flag === '1') setAuthorized(true)
    else setShowAuthModal(true)
    setAuthChecked(true)
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    const resp = await callFn({ action: 'dre_cascata', ano, mes, view })
    setLoading(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    setData(resp as DreData)
  }, [callFn, ano, mes, view])

  useEffect(() => {
    if (!authorized) return
    void load()
  }, [authorized, load])

  const loadCategorias = useCallback(async () => {
    setLoadingCats(true)
    const resp = await callFn({ action: 'categorias_listar_com_grupo' })
    setLoadingCats(false)
    if (resp?.error) { showMsg('err', resp.error); return }
    setCategorias(resp.categorias || [])
  }, [callFn])

  const setGrupo = useCallback(async (categoriaId: string, novoGrupo: string | null) => {
    // Otimista
    setCategorias((prev) => prev.map((c) => c.id === categoriaId ? { ...c, grupo_dre: novoGrupo } : c))
    const resp = await callFn({ action: 'categorias_set_grupo', categoria_id: categoriaId, grupo_dre: novoGrupo })
    if (resp?.error) {
      showMsg('err', resp.error)
      void loadCategorias()
      return
    }
    showMsg('ok', 'Categoria reclassificada. Atualize o DRE para ver o efeito.')
  }, [callFn, loadCategorias])

  if (!authChecked) return <NGPLoading loading loadingText="Verificando acesso..." />

  if (!authorized) {
    return (
      <FinanceiroAuthModal
        onClose={() => router.replace('/setores')}
        onSuccess={() => {
          sessionStorage.setItem('fin_auth_ok', '1')
          setAuthorized(true)
          setShowAuthModal(false)
        }}
      />
    )
  }

  const c = data?.cascata
  const receita = c?.receita_operacional.valor || 0

  return (
    <div className={styles.layout}>
      <Sidebar minimal sectorNavTitle="FINANCEIRO" sectorNav={financeiroNav} />
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>DRE — Demonstração de Resultado</h1>
            <p className={styles.subtitle}>
              Como foi o resultado da empresa em <strong>{data?.periodo_label || ano}</strong> · {view === 'competencia' ? 'Regime de Competência' : 'Regime de Caixa'}
            </p>
          </div>
          <div className={styles.headerActions}>
            <button className={styles.btnSecondary} onClick={() => { setShowClassifier(true); void loadCategorias() }}>
              ⚙️ Classificar categorias
            </button>
            <select
              className={styles.anoSelect}
              value={mes === null ? '' : String(mes)}
              onChange={(e) => setMes(e.target.value === '' ? null : Number(e.target.value))}
              disabled={loading}
              title="Mês"
            >
              <option value="">Ano todo</option>
              {MESES_LABEL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select
              className={styles.anoSelect}
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              disabled={loading}
              title="Ano"
            >
              {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <div className={styles.viewToggle}>
              <button
                className={`${styles.viewToggleBtn} ${view === 'competencia' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setView('competencia')}
                disabled={loading}
              >
                Competência
              </button>
              <button
                className={`${styles.viewToggleBtn} ${view === 'caixa' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setView('caixa')}
                disabled={loading}
              >
                Caixa
              </button>
            </div>
            <button className={styles.btnRefresh} onClick={() => void load()} disabled={loading}>
              {loading ? '⏳' : '↻'}
            </button>
          </div>
        </header>

        {msg && <div className={`${styles.toast} ${msg.type === 'ok' ? styles.toastOk : styles.toastErr}`}>{msg.text}</div>}

        {!data && loading && <div className={styles.empty}>Calculando DRE...</div>}

        {c && (
          <>
            {/* HERO: Resultado final + margens */}
            <section className={styles.hero}>
              <div className={styles.heroMain}>
                <span className={styles.heroLabel}>Resultado final · {data.periodo_label}</span>
                <span className={`${styles.heroValue} ${c.resultado_final >= 0 ? styles.posValue : styles.negValue}`}>
                  {fmtBRL(c.resultado_final)}
                </span>
                <span className={styles.heroSub}>{data.total_transacoes.toLocaleString('pt-BR')} lançamentos analisados</span>
              </div>
              <div className={styles.heroMetrics}>
                <Margem label="Margem bruta" value={data.margens.bruta} hint="Lucro Bruto / Receita líquida. Saúde da margem por venda." />
                <Margem label="Margem operacional" value={data.margens.operacional} hint="Lucro Operacional / Receita líquida. Saúde da operação." />
                <Margem label="Margem líquida" value={data.margens.liquida} hint="Resultado Final / Receita líquida. Quanto vira lucro de fato." />
              </div>
            </section>

            {/* CASCATA */}
            <section className={styles.cascataWrap}>
              <Linha icone="+" label="Receita operacional" valor={c.receita_operacional.valor} pct={pctOf(c.receita_operacional.valor, receita)} hint={HINTS.receita_operacional} tone="entrada" big />
              <Linha icone="−" label="Deduções da receita" valor={c.deducoes.valor} pct={pctOf(c.deducoes.valor, receita)} hint={HINTS.deducoes} tone="saida" />
              <LinhaTotal label="Receita líquida" valor={c.receita_liquida} pct="100%" hint={HINTS.receita_liquida} />

              <Linha icone="−" label="Custos variáveis" valor={c.custo_variavel.valor} pct={pctOf(c.custo_variavel.valor, receita)} hint={HINTS.custo_variavel} tone="saida" />
              <LinhaTotal label="Lucro bruto" valor={c.lucro_bruto} pct={pctOf(c.lucro_bruto, receita)} hint={HINTS.lucro_bruto} positivo />

              <div className={styles.subgrupoLabel}>Despesas operacionais</div>
              <Linha icone="−" label="Despesas comerciais / marketing" valor={c.despesa_comercial.valor} pct={pctOf(c.despesa_comercial.valor, receita)} hint="Anúncios, eventos, brindes — atrair cliente." tone="saida" indented />
              <Linha icone="−" label="Despesas administrativas" valor={c.despesa_administrativa.valor} pct={pctOf(c.despesa_administrativa.valor, receita)} hint="Aluguel, software, contabilidade — tocar a empresa." tone="saida" indented />
              <Linha icone="−" label="Despesas com pessoal" valor={c.despesa_pessoal.valor} pct={pctOf(c.despesa_pessoal.valor, receita)} hint="Folha, vale, FGTS, treinamentos." tone="saida" indented />
              <Linha icone="−" label="Outras despesas operacionais" valor={c.despesa_outras.valor} pct={pctOf(c.despesa_outras.valor, receita)} hint="Combustível, deslocamento, despesas pequenas." tone="saida" indented />
              <LinhaTotal label="Lucro operacional" valor={c.lucro_operacional} pct={pctOf(c.lucro_operacional, receita)} hint={HINTS.lucro_operacional} positivo />

              <div className={styles.subgrupoLabel}>Resultado financeiro</div>
              <Linha icone="+" label="Receitas financeiras / outras" valor={c.receita_financeira.valor + c.outras_receitas.valor} pct={pctOf(c.receita_financeira.valor + c.outras_receitas.valor, receita)} hint="Juros recebidos, rendimentos, outras receitas não operacionais." tone="entrada" indented />
              <Linha icone="−" label="Despesas financeiras" valor={c.despesa_financeira.valor} pct={pctOf(c.despesa_financeira.valor, receita)} hint="Tarifas bancárias, juros pagos, IOF." tone="saida" indented />
              <LinhaTotal label="Lucro antes do IR/CSLL" valor={c.lucro_antes_ir} pct={pctOf(c.lucro_antes_ir, receita)} hint="Lucro operacional + resultado financeiro." positivo />

              {c.imposto_lucro.valor > 0 && (
                <Linha icone="−" label="IR / CSLL" valor={c.imposto_lucro.valor} pct={pctOf(c.imposto_lucro.valor, receita)} hint={HINTS.imposto_lucro} tone="saida" />
              )}
              <Linha icone="−" label="Pró-labore / dividendos" valor={c.prolabore_dividendos.valor} pct={pctOf(c.prolabore_dividendos.valor, receita)} hint={HINTS.prolabore} tone="saida" />

              <div className={styles.linhaFinal}>
                <div className={styles.linhaFinalLeft}>
                  <span className={styles.linhaFinalLabel}>Resultado final</span>
                  <span className={styles.linhaFinalHint}>O lucro líquido do ano. {HINTS.resultado_final}</span>
                </div>
                <div className={styles.linhaFinalRight}>
                  <span className={`${styles.linhaFinalValue} ${c.resultado_final >= 0 ? styles.posValue : styles.negValue}`}>
                    {fmtBRL(c.resultado_final)}
                  </span>
                  <span className={styles.linhaFinalPct}>{pctOf(c.resultado_final, receita)} da receita</span>
                </div>
              </div>
            </section>
          </>
        )}

        {showClassifier && (
          <ClassifierModal
            categorias={categorias}
            loading={loadingCats}
            onClose={() => setShowClassifier(false)}
            onSetGrupo={setGrupo}
            onRefresh={loadCategorias}
            onReloadDre={load}
          />
        )}
      </main>
    </div>
  )
}

function Margem({ label, value, hint }: { label: string; value: number; hint: string }) {
  const pct = (value * 100).toFixed(1)
  const tone = value >= 0.20 ? styles.margemBoa : value >= 0.05 ? styles.margemOk : styles.margemRuim
  return (
    <div className={`${styles.margemCard} ${tone}`} title={hint}>
      <span className={styles.margemLabel}>{label}</span>
      <span className={styles.margemValue}>{pct}%</span>
    </div>
  )
}

function Linha({ icone, label, valor, pct, hint, tone, indented, big }: { icone: string; label: string; valor: number; pct: string; hint: string; tone: 'entrada' | 'saida'; indented?: boolean; big?: boolean }) {
  return (
    <div className={`${styles.linha} ${indented ? styles.linhaIndented : ''} ${big ? styles.linhaBig : ''}`} title={hint}>
      <div className={styles.linhaLeft}>
        <span className={`${styles.linhaIcon} ${tone === 'entrada' ? styles.iconEntrada : styles.iconSaida}`}>{icone}</span>
        <span className={styles.linhaLabel}>{label}</span>
      </div>
      <div className={styles.linhaRight}>
        <span className={`${styles.linhaValor} ${tone === 'entrada' ? styles.posValue : styles.negValue}`}>{fmtBRL(valor)}</span>
        <span className={styles.linhaPct}>{pct}</span>
      </div>
    </div>
  )
}

function LinhaTotal({ label, valor, pct, hint, positivo }: { label: string; valor: number; pct: string; hint: string; positivo?: boolean }) {
  const isPos = positivo === undefined ? valor >= 0 : positivo
  return (
    <div className={styles.linhaTotal} title={hint}>
      <div className={styles.linhaLeft}>
        <span className={styles.linhaTotalIcon}>=</span>
        <span className={styles.linhaTotalLabel}>{label}</span>
      </div>
      <div className={styles.linhaRight}>
        <span className={`${styles.linhaTotalValor} ${isPos && valor >= 0 ? styles.posValue : valor < 0 ? styles.negValue : ''}`}>{fmtBRL(valor)}</span>
        <span className={styles.linhaPct}>{pct}</span>
      </div>
    </div>
  )
}

function ClassifierModal({ categorias, loading, onClose, onSetGrupo, onRefresh, onReloadDre }: {
  categorias: CategoriaItem[]
  loading: boolean
  onClose: () => void
  onSetGrupo: (id: string, grupo: string | null) => void
  onRefresh: () => void
  onReloadDre: () => void
}) {
  // Agrupa por grupo_dre
  const byGrupo: Record<string, CategoriaItem[]> = {}
  for (const c of categorias) {
    const k = c.grupo_dre || '__sem_grupo__'
    if (!byGrupo[k]) byGrupo[k] = []
    byGrupo[k].push(c)
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h2>Classificar categorias por grupo do DRE</h2>
          <p>Mude o grupo de uma categoria pra ela aparecer na linha certa do DRE em cascata.</p>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </header>
        <div className={styles.modalBody}>
          {loading && <div className={styles.empty}>Carregando categorias...</div>}
          {!loading && categorias.length === 0 && <div className={styles.empty}>Nenhuma categoria encontrada.</div>}
          {!loading && byGrupo['__sem_grupo__'] && (
            <div className={styles.grupoSection}>
              <h3 className={styles.grupoTitle}>⚠️ Sem classificação ({byGrupo['__sem_grupo__'].length})</h3>
              {byGrupo['__sem_grupo__'].map((c) => <CategoriaRow key={c.id} c={c} onSetGrupo={onSetGrupo} />)}
            </div>
          )}
          {GRUPOS_ORDEM.map((g) => byGrupo[g] && byGrupo[g].length > 0 && (
            <div key={g} className={styles.grupoSection}>
              <h3 className={styles.grupoTitle}>{GRUPOS_LABEL[g]} ({byGrupo[g].length})</h3>
              {byGrupo[g].map((c) => <CategoriaRow key={c.id} c={c} onSetGrupo={onSetGrupo} />)}
            </div>
          ))}
        </div>
        <footer className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onRefresh}>↻ Recarregar lista</button>
          <button className={styles.btnPrimary} onClick={() => { onReloadDre(); onClose() }}>
            Aplicar e atualizar DRE
          </button>
        </footer>
      </div>
    </div>
  )
}

function CategoriaRow({ c, onSetGrupo }: { c: CategoriaItem; onSetGrupo: (id: string, grupo: string | null) => void }) {
  return (
    <div className={styles.catRow}>
      <div className={styles.catLeft}>
        <span className={`${styles.catTipo} ${c.tipo === 'entrada' ? styles.tipoEntrada : styles.tipoSaida}`}>
          {c.tipo === 'entrada' ? '↑' : '↓'}
        </span>
        <div className={styles.catInfo}>
          <span className={styles.catNome}>{c.nome}</span>
          <span className={styles.catUso}>{c.count} lançamentos · {fmtBRL(c.total)}</span>
        </div>
      </div>
      <select
        className={styles.catSelect}
        value={c.grupo_dre || ''}
        onChange={(e) => onSetGrupo(c.id, e.target.value || null)}
      >
        <option value="">— sem classificação —</option>
        {GRUPOS_ORDEM.map((g) => <option key={g} value={g}>{GRUPOS_LABEL[g]}</option>)}
      </select>
    </div>
  )
}

export default function DrePage() {
  return (
    <Suspense fallback={<NGPLoading loading loadingText="Carregando DRE..." />}>
      <DreInner />
    </Suspense>
  )
}
