'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './PeriodFilter.module.css'
import { DateParam } from '@/types'

interface Props {
  onApply: (main: DateParam, mainLabel: string, cmp?: DateParam, cmpLabel?: string) => void
}

const PRESETS = [
  { value: 'last30',     label: 'Últimos 30 dias', preset: 'last_30d'    },
  { value: 'today',      label: 'Hoje',             preset: 'today'       },
  { value: 'yesterday',  label: 'Ontem',            preset: 'yesterday'   },
  { value: 'last7',      label: 'Últimos 7 dias',   preset: 'last_7d'     },
  { value: 'thismonth',  label: 'Este mês',         preset: 'this_month'  },
  { value: 'lastmonth',  label: 'Mês anterior',     preset: 'last_month'  },
  { value: 'last90',     label: 'Últimos 90 dias',  preset: 'last_90d'    },
  { value: 'custom',     label: '📅 Personalizado', preset: ''            },
]

const CMP_PRESETS = [
  { value: 'prev',      label: '↩ Período anterior' },
  { value: 'lastmonth', label: 'Mês anterior'       },
  { value: 'last30',    label: 'Últimos 30 dias'    },
  { value: 'last7',     label: 'Últimos 7 dias'     },
  { value: 'last90',    label: 'Últimos 90 dias'    },
  { value: 'custom',    label: '📅 Personalizado'   },
]

const fmt = (d: Date) => d.toISOString().slice(0, 10)
const fmtBr = (iso: string) => iso.split('-').reverse().join('/')
const MONTHS_PT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.']
const WEEKDAYS_PT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

function parseIsoDate(iso: string) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function DatePickerField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  ariaLabel: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const initial = parseIsoDate(value) || new Date()
  const [viewMonth, setViewMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1))

  useEffect(() => {
    function onOutsideClick(ev: MouseEvent) {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutsideClick)
    return () => document.removeEventListener('mousedown', onOutsideClick)
  }, [])

  useEffect(() => {
    if (!open) return
    const dt = parseIsoDate(value)
    if (dt) setViewMonth(new Date(dt.getFullYear(), dt.getMonth(), 1))
  }, [open, value])

  const weeks = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    const start = new Date(first)
    start.setDate(first.getDate() - first.getDay())
    const days: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      days.push(d)
    }
    return days
  }, [viewMonth])

  const selected = parseIsoDate(value)

  function pickDay(d: Date) {
    onChange(fmt(d))
    setOpen(false)
  }

  return (
    <div className={styles.calendarField} ref={rootRef}>
      <button type="button" className={styles.calendarInput} onClick={() => setOpen(v => !v)} aria-label={ariaLabel}>
        <span className={value ? styles.calendarValue : styles.calendarPlaceholder}>
          {value ? fmtBr(value) : 'DD/MM/YYYY'}
        </span>
        <svg className={styles.calendarIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      {open && (
        <div className={styles.calendarPop}>
          <div className={styles.calendarHead}>
            <div className={styles.calendarMonth}>{`${MONTHS_PT[viewMonth.getMonth()]} de ${viewMonth.getFullYear()}`}</div>
            <div className={styles.calendarNav}>
              <button type="button" className={styles.calendarNavBtn} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>‹</button>
              <button type="button" className={styles.calendarNavBtn} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>›</button>
            </div>
          </div>

          <div className={styles.calendarWeekdays}>
            {WEEKDAYS_PT.map((d, idx) => <span key={`${d}-${idx}`}>{d}</span>)}
          </div>

          <div className={styles.calendarGrid}>
            {weeks.map((d, idx) => {
              const isCurrentMonth = d.getMonth() === viewMonth.getMonth()
              const isSelected = !!selected && sameDay(d, selected)
              return (
                <button
                  key={idx}
                  type="button"
                  className={`${styles.calendarDay} ${isCurrentMonth ? '' : styles.calendarDayMuted} ${isSelected ? styles.calendarDaySelected : ''}`}
                  onClick={() => pickDay(d)}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** Calcula o período anterior equivalente ao preset/range fornecido */
function computePrevPeriod(
  mainPreset: string,
  mainSince?: string,
  mainUntil?: string,
): { dp: DateParam; label: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // Custom range: desloca para trás pelo mesmo número de dias
  if (mainSince && mainUntil) {
    const s = new Date(mainSince), u = new Date(mainUntil)
    const days = Math.round((u.getTime() - s.getTime()) / 86400000) + 1
    const prevUntil = new Date(s.getTime() - 86400000)
    const prevSince = new Date(prevUntil.getTime() - (days - 1) * 86400000)
    const label = `${fmtBr(fmt(prevSince))} – ${fmtBr(fmt(prevUntil))}`
    return { dp: { time_range: JSON.stringify({ since: fmt(prevSince), until: fmt(prevUntil) }) }, label }
  }

  switch (mainPreset) {
    case 'last_30d': {
      const until = new Date(today.getTime() - 31 * 86400000)
      const since = new Date(until.getTime() - 29 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} – ${fmtBr(fmt(until))}` }
    }
    case 'last_7d': {
      const until = new Date(today.getTime() - 8 * 86400000)
      const since = new Date(until.getTime() - 6 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} – ${fmtBr(fmt(until))}` }
    }
    case 'last_90d': {
      const until = new Date(today.getTime() - 91 * 86400000)
      const since = new Date(until.getTime() - 89 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} – ${fmtBr(fmt(until))}` }
    }
    case 'today':
      return { dp: { date_preset: 'yesterday' }, label: 'Ontem' }
    case 'yesterday': {
      const d = new Date(today.getTime() - 2 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(d), until: fmt(d) }) }, label: fmtBr(fmt(d)) }
    }
    case 'this_month':
      return { dp: { date_preset: 'last_month' }, label: 'Mês anterior' }
    case 'last_month': {
      const firstLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const firstPrevMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1)
      const lastPrevMonth  = new Date(firstLastMonth.getTime() - 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(firstPrevMonth), until: fmt(lastPrevMonth) }) }, label: `${fmtBr(fmt(firstPrevMonth))} – ${fmtBr(fmt(lastPrevMonth))}` }
    }
    default: {
      const until = new Date(today.getTime() - 31 * 86400000)
      const since = new Date(until.getTime() - 29 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} – ${fmtBr(fmt(until))}` }
    }
  }
}

export default function PeriodFilter({ onApply }: Props) {
  const [period, setPeriod]     = useState('last30')
  const [since, setSince]       = useState('')
  const [until, setUntil]       = useState('')

  const [compareEnabled, setCompareEnabled] = useState(false)
  const [cmpPeriod, setCmpPeriod]           = useState('prev')
  const [cmpSince, setCmpSince]             = useState('')
  const [cmpUntil, setCmpUntil]             = useState('')

  /** Retorna o DateParam + label do período principal atual */
  function getMainDp(): { dp: DateParam; label: string; preset: string; since?: string; until?: string } | null {
    if (period === 'custom') {
      if (!since || !until) return null
      const label = `${fmtBr(since)} – ${fmtBr(until)}`
      return { dp: { time_range: JSON.stringify({ since, until }) }, label, preset: 'custom', since, until }
    }
    const found = PRESETS.find(p => p.value === period)!
    return { dp: { date_preset: found.preset }, label: found.label, preset: found.preset }
  }

  /** Resolve o DateParam de comparação dado o valor do select */
  function resolveCmpDp(val: string, mainPreset: string, mainSince?: string, mainUntil?: string): { dp: DateParam; label: string } | undefined {
    if (val === 'prev') return computePrevPeriod(mainPreset, mainSince, mainUntil)
    if (val === 'custom') return undefined
    const found = PRESETS.find(p => p.value === val) || CMP_PRESETS.find(p => p.value === val)
    if (!found) return undefined
    const presetFound = PRESETS.find(p => p.value === val)
    if (!presetFound) return undefined
    return { dp: { date_preset: presetFound.preset }, label: presetFound.label }
  }

  function handleMainChange(val: string) {
    setPeriod(val)
    if (val === 'custom') {
      const t = new Date().toISOString().slice(0, 10)
      const b = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      setSince(b); setUntil(t)
      return
    }
    const found = PRESETS.find(p => p.value === val)!
    const cmp = compareEnabled ? resolveCmpDp(cmpPeriod, found.preset) : undefined
    onApply({ date_preset: found.preset }, found.label, cmp?.dp, cmp?.label)
  }

  function applyCustomMain() {
    if (!since || !until) return alert('Selecione as duas datas.')
    if (since > until) return alert('A data inicial deve ser antes da data final.')
    const label = `${fmtBr(since)} – ${fmtBr(until)}`
    const cmp = compareEnabled ? resolveCmpDp(cmpPeriod, 'custom', since, until) : undefined
    onApply({ time_range: JSON.stringify({ since, until }) }, label, cmp?.dp, cmp?.label)
  }

  function handleCmpChange(val: string) {
    setCmpPeriod(val)
    if (val === 'custom') {
      const t = new Date().toISOString().slice(0, 10)
      const b = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      setCmpSince(b); setCmpUntil(t)
      return
    }
    const main = getMainDp()
    if (!main) return
    const cmp = resolveCmpDp(val, main.preset, main.since, main.until)
    if (cmp) onApply(main.dp, main.label, cmp.dp, cmp.label)
  }

  function applyCustomCmp() {
    if (!cmpSince || !cmpUntil) return alert('Selecione as duas datas de comparação.')
    if (cmpSince > cmpUntil) return alert('A data inicial deve ser antes da data final.')
    const main = getMainDp()
    if (!main) return alert('Aplique o período principal primeiro.')
    const cmpLabel = `${fmtBr(cmpSince)} – ${fmtBr(cmpUntil)}`
    onApply(main.dp, main.label, { time_range: JSON.stringify({ since: cmpSince, until: cmpUntil }) }, cmpLabel)
  }

  function toggleCompare() {
    const next = !compareEnabled
    setCompareEnabled(next)
    const main = getMainDp()
    if (!main) return
    if (!next) {
      onApply(main.dp, main.label)
    } else {
      const cmp = resolveCmpDp(cmpPeriod, main.preset, main.since, main.until)
      if (cmp) onApply(main.dp, main.label, cmp.dp, cmp.label)
    }
  }

  return (
    <div className={styles.wrap}>
      <select className={styles.select} value={period} onChange={e => handleMainChange(e.target.value)}>
        {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>

      {period === 'custom' && (
        <div className={styles.customWrap}>
          <DatePickerField value={since} onChange={setSince} ariaLabel="Data inicial" />
          <span className={styles.sep}>até</span>
          <DatePickerField value={until} onChange={setUntil} ariaLabel="Data final" />
          <button className={styles.applyBtn} onClick={applyCustomMain}>Aplicar</button>
        </div>
      )}

      <button
        className={`${styles.compareBtn} ${compareEnabled ? styles.compareBtnActive : ''}`}
        onClick={toggleCompare}
      >
        ⟷ {compareEnabled ? 'Comparando' : 'Comparar'}
      </button>

        {compareEnabled && (
        <div className={styles.cmpSection}>
          <span className={styles.cmpVs}>vs.</span>
          <select className={styles.select} value={cmpPeriod} onChange={e => handleCmpChange(e.target.value)}>
            {CMP_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {cmpPeriod === 'custom' && (
            <div className={styles.customWrap}>
              <DatePickerField value={cmpSince} onChange={setCmpSince} ariaLabel="Comparação inicial" />
              <span className={styles.sep}>até</span>
              <DatePickerField value={cmpUntil} onChange={setCmpUntil} ariaLabel="Comparação final" />
              <button className={styles.applyBtn} onClick={applyCustomCmp}>Aplicar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
