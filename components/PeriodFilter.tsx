'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './PeriodFilter.module.css'
import { DateParam } from '@/types'

interface Props {
  onApply: (main: DateParam, mainLabel: string, cmp?: DateParam, cmpLabel?: string) => void
}

interface PeriodOption {
  value: string
  label: string
  preset?: string
}

const PRESETS: PeriodOption[] = [
  { value: 'last30', label: 'Últimos 30 dias', preset: 'last_30d' },
  { value: 'today', label: 'Hoje', preset: 'today' },
  { value: 'yesterday', label: 'Ontem', preset: 'yesterday' },
  { value: 'last7', label: 'Últimos 7 dias', preset: 'last_7d' },
  { value: 'thismonth', label: 'Este mês', preset: 'this_month' },
  { value: 'lastmonth', label: 'Mês anterior', preset: 'last_month' },
  { value: 'last90', label: 'Últimos 90 dias', preset: 'last_90d' },
  { value: 'custom', label: 'Personalizado' },
]

const CMP_PRESETS: PeriodOption[] = [
  { value: 'prev', label: 'Período anterior' },
  { value: 'lastmonth', label: 'Mês anterior' },
  { value: 'last30', label: 'Últimos 30 dias' },
  { value: 'last7', label: 'Últimos 7 dias' },
  { value: 'last90', label: 'Últimos 90 dias' },
  { value: 'custom', label: 'Personalizado' },
]

const MONTHS_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

const WEEKDAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
const fmt = (d: Date) => d.toISOString().slice(0, 10)
const fmtBr = (iso: string) => iso.split('-').reverse().join('/')

function parseIsoDate(iso: string) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isBetween(date: Date, start: Date, end: Date) {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()
  const to = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()
  return target > from && target < to
}

function normalizeRange(start?: Date | null, end?: Date | null) {
  if (!start || !end) return { start: null, end: null }
  return start.getTime() <= end.getTime() ? { start, end } : { start: end, end: start }
}

function useOutsideClick<T extends HTMLElement>(handler: () => void) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    function onMouseDown(ev: MouseEvent) {
      if (!ref.current?.contains(ev.target as Node)) handler()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [handler])

  return ref
}

const CalendarGlyph = () => (
  <svg className={styles.calendarIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="17" rx="2.5" />
    <line x1="8" y1="2.5" x2="8" y2="6.5" />
    <line x1="16" y1="2.5" x2="16" y2="6.5" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)

function SelectChevron({ open }: { open: boolean }) {
  return (
    <svg className={`${styles.selectChevron} ${open ? styles.selectChevronOpen : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function FilterSelect({
  caption,
  value,
  options,
  onChange,
}: {
  caption: string
  value: string
  options: PeriodOption[]
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useOutsideClick<HTMLDivElement>(() => setOpen(false))
  const selected = options.find(option => option.value === value) || options[0]

  return (
    <div className={styles.selectWrap} ref={rootRef}>
      <button
        type="button"
        className={`${styles.selectTrigger} ${open ? styles.selectTriggerOpen : ''}`}
        onClick={() => setOpen(prev => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.selectCopy}>
          <span className={styles.selectCaption}>{caption}</span>
          <span className={styles.selectValue}>{selected.label}</span>
        </span>
        <CalendarGlyph />
        <SelectChevron open={open} />
      </button>

      {open && (
        <div className={styles.selectMenu} role="listbox">
          {options.map(option => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={`${styles.selectOption} ${active ? styles.selectOptionActive : ''}`}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className={styles.selectOptionCheck}>{active ? '✓' : ''}</span>
                <span className={styles.selectOptionLabel}>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DateRangeField({
  since,
  until,
  onChange,
  ariaLabel,
  caption,
}: {
  since: string
  until: string
  onChange: (since: string, until: string) => void
  ariaLabel: string
  caption: string
}) {
  const [open, setOpen] = useState(false)
  // `selecting` = o usuário já começou a montar um intervalo NESTA abertura.
  // Enquanto false, o intervalo exibido veio pré-preenchido (ex: últimos 30 dias):
  // o primeiro clique então inicia uma seleção limpa, sem o "flash" de tudo sumindo.
  const [selecting, setSelecting] = useState(false)
  // Dia sob o cursor enquanto o intervalo está sendo montado (só início escolhido).
  // Serve pra pintar o preview do período antes do segundo clique.
  const [hoverDate, setHoverDate] = useState<string>('')
  const rootRef = useOutsideClick<HTMLDivElement>(() => setOpen(false))
  const [viewMonth, setViewMonth] = useState(() => {
    const initial = parseIsoDate(since) || new Date()
    return new Date(initial.getFullYear(), initial.getMonth(), 1)
  })
  const today = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }, [])

  // Quando ABRE o calendário, posiciona o viewMonth no início do intervalo e
  // zera o flag de seleção. Depende só de `open` pra não resetar a cada clique.
  useEffect(() => {
    if (!open) return
    setSelecting(false)
    setHoverDate('')
    const dt = parseIsoDate(since) || new Date()
    setViewMonth(new Date(dt.getFullYear(), dt.getMonth(), 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const days = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    const start = new Date(first)
    start.setDate(first.getDate() - first.getDay())
    const allDays: Date[] = []
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      allDays.push(date)
    }
    return allDays
  }, [viewMonth])

  const normalizedRange = useMemo(() => {
    return normalizeRange(parseIsoDate(since), parseIsoDate(until))
  }, [since, until])

  // Preview do intervalo enquanto só o início está escolhido: do `since` até o dia
  // sob o cursor (`hoverDate`). Só vale durante a montagem (sem `until` ainda).
  const previewRange = useMemo(() => {
    if (!selecting || !since || until || !hoverDate) return { start: null, end: null }
    return normalizeRange(parseIsoDate(since), parseIsoDate(hoverDate))
  }, [selecting, since, until, hoverDate])

  // Seleção por dois cliques num único calendário:
  // - 1º clique da abertura (intervalo veio pré-preenchido) → inicia novo início limpo
  // - sem intervalo completo (sem `until`) e clique >= since → fecha o fim
  // - sem intervalo completo e clique < since → o clique vira o novo início
  // - intervalo já completo → recomeça um novo intervalo a partir do dia clicado
  function pickDay(date: Date) {
    const iso = fmt(date)
    const hasFullRange = !!since && !!until

    if (!selecting || !since || hasFullRange) {
      setSelecting(true)
      onChange(iso, '')
      return
    }

    if (iso < since) {
      onChange(iso, '')
      return
    }

    onChange(since, iso)
    setOpen(false)
  }

  function pickToday() {
    const iso = fmt(today)
    // Só fecha o fim com "Hoje" se já estamos montando um intervalo nesta abertura.
    if (selecting && since && !until && iso >= since) {
      onChange(since, iso)
      setOpen(false)
      return
    }
    setSelecting(true)
    onChange(iso, '')
  }

  function clearValue() {
    setSelecting(true)
    onChange('', '')
    setOpen(false)
  }

  const rangeLabel = since && until
    ? `${fmtBr(since)} - ${fmtBr(until)}`
    : since
      ? `${fmtBr(since)} - …`
      : 'Selecionar período'

  return (
    <div className={`${styles.calendarField} ${styles.calendarFieldRange}`} ref={rootRef}>
      <button
        type="button"
        className={`${styles.calendarInput} ${open ? styles.calendarInputOpen : ''} ${since ? styles.calendarInputFilled : ''}`}
        onClick={() => setOpen(prev => !prev)}
        aria-label={ariaLabel}
      >
        <span className={styles.calendarInputCopy}>
          <span className={styles.calendarInputLabel}>{caption}</span>
          <span className={since ? styles.calendarValue : styles.calendarPlaceholder}>{rangeLabel}</span>
        </span>
        <CalendarGlyph />
      </button>

      {open && (
        <div className={styles.calendarPop}>
          <div className={styles.calendarHead}>
            <button
              type="button"
              className={styles.calendarNavBtn}
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <div className={styles.calendarMonth}>{`${MONTHS_PT[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`}</div>
            <button
              type="button"
              className={styles.calendarNavBtn}
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
              aria-label="Próximo mês"
            >
              ›
            </button>
          </div>

          <div className={styles.calendarWeekdays}>
            {WEEKDAYS_PT.map(day => <span key={day}>{day}</span>)}
          </div>

          <div className={styles.calendarGrid} onMouseLeave={() => setHoverDate('')}>
            {days.map((date) => {
              const isCurrentMonth = date.getMonth() === viewMonth.getMonth()
              const isToday = sameDay(date, today)
              const isRangeStart = !!normalizedRange.start && sameDay(date, normalizedRange.start)
              const isRangeEnd = !!normalizedRange.end && sameDay(date, normalizedRange.end)
              const isInRange = !!normalizedRange.start && !!normalizedRange.end && isBetween(date, normalizedRange.start, normalizedRange.end)
              const isRangeSolo = isRangeStart && isRangeEnd

              // Preview ao passar o mouse: pinta o miolo em azul claro e a ponta sob
              // o cursor com um destaque mais suave que o início já fixado.
              const isPreviewStart = !!previewRange.start && sameDay(date, previewRange.start)
              const isPreviewEnd = !!previewRange.end && sameDay(date, previewRange.end)
              const isPreviewMid = !!previewRange.start && !!previewRange.end && isBetween(date, previewRange.start, previewRange.end)
              const isPreviewTip = (isPreviewStart || isPreviewEnd) && !isRangeStart

              const classNames = [
                styles.calendarDay,
                !isCurrentMonth ? styles.calendarDayMuted : '',
                isToday ? styles.calendarDayToday : '',
                isInRange || isPreviewMid ? styles.calendarDayInRange : '',
                isPreviewTip ? styles.calendarDayPreviewTip : '',
                isRangeStart ? styles.calendarDayRangeStart : '',
                isRangeEnd ? styles.calendarDayRangeEnd : '',
                isRangeSolo ? styles.calendarDayRangeSolo : '',
              ].filter(Boolean).join(' ')

              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  className={classNames}
                  onClick={() => pickDay(date)}
                  onMouseEnter={() => setHoverDate(fmt(date))}
                >
                  <span>{date.getDate()}</span>
                </button>
              )
            })}
          </div>

          <div className={styles.calendarFooter}>
            <button type="button" className={styles.calendarFooterBtn} onClick={pickToday}>Hoje</button>
            <button type="button" className={styles.calendarFooterBtn} onClick={clearValue}>Limpar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function computePrevPeriod(
  mainPreset: string,
  mainSince?: string,
  mainUntil?: string,
): { dp: DateParam; label: string } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (mainSince && mainUntil) {
    const since = new Date(mainSince)
    const until = new Date(mainUntil)
    const days = Math.round((until.getTime() - since.getTime()) / 86400000) + 1
    const prevUntil = new Date(since.getTime() - 86400000)
    const prevSince = new Date(prevUntil.getTime() - (days - 1) * 86400000)
    const label = `${fmtBr(fmt(prevSince))} - ${fmtBr(fmt(prevUntil))}`
    return {
      dp: { time_range: JSON.stringify({ since: fmt(prevSince), until: fmt(prevUntil) }) },
      label,
    }
  }

  switch (mainPreset) {
    case 'last_30d': {
      const until = new Date(today.getTime() - 31 * 86400000)
      const since = new Date(until.getTime() - 29 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} - ${fmtBr(fmt(until))}` }
    }
    case 'last_7d': {
      const until = new Date(today.getTime() - 8 * 86400000)
      const since = new Date(until.getTime() - 6 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} - ${fmtBr(fmt(until))}` }
    }
    case 'last_90d': {
      const until = new Date(today.getTime() - 91 * 86400000)
      const since = new Date(until.getTime() - 89 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} - ${fmtBr(fmt(until))}` }
    }
    case 'today':
      return { dp: { date_preset: 'yesterday' }, label: 'Ontem' }
    case 'yesterday': {
      const date = new Date(today.getTime() - 2 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(date), until: fmt(date) }) }, label: fmtBr(fmt(date)) }
    }
    case 'this_month':
      return { dp: { date_preset: 'last_month' }, label: 'Mês anterior' }
    case 'last_month': {
      const firstLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const firstPrevMonth = new Date(today.getFullYear(), today.getMonth() - 2, 1)
      const lastPrevMonth = new Date(firstLastMonth.getTime() - 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(firstPrevMonth), until: fmt(lastPrevMonth) }) }, label: `${fmtBr(fmt(firstPrevMonth))} - ${fmtBr(fmt(lastPrevMonth))}` }
    }
    default: {
      const until = new Date(today.getTime() - 31 * 86400000)
      const since = new Date(until.getTime() - 29 * 86400000)
      return { dp: { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) }, label: `${fmtBr(fmt(since))} - ${fmtBr(fmt(until))}` }
    }
  }
}

export default function PeriodFilter({ onApply }: Props) {
  const [period, setPeriod] = useState('last30')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [cmpPeriod, setCmpPeriod] = useState('prev')
  const [cmpSince, setCmpSince] = useState('')
  const [cmpUntil, setCmpUntil] = useState('')

  function getMainDp(): { dp: DateParam; label: string; preset: string; since?: string; until?: string } | null {
    if (period === 'custom') {
      if (!since || !until) return null
      return {
        dp: { time_range: JSON.stringify({ since, until }) },
        label: `${fmtBr(since)} - ${fmtBr(until)}`,
        preset: 'custom',
        since,
        until,
      }
    }

    const found = PRESETS.find(option => option.value === period)
    if (!found?.preset) return null

    return {
      dp: { date_preset: found.preset },
      label: found.label,
      preset: found.preset,
    }
  }

  function resolveCmpDp(
    value: string,
    mainPreset: string,
    mainSince?: string,
    mainUntil?: string,
  ): { dp: DateParam; label: string } | undefined {
    if (value === 'prev') return computePrevPeriod(mainPreset, mainSince, mainUntil)
    if (value === 'custom') return undefined

    const found = PRESETS.find(option => option.value === value)
    if (!found?.preset) return undefined
    return { dp: { date_preset: found.preset }, label: found.label }
  }

  function handleMainChange(next: string) {
    setPeriod(next)

    if (next === 'custom') {
      const today = new Date().toISOString().slice(0, 10)
      const base = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      setSince(base)
      setUntil(today)
      return
    }

    const found = PRESETS.find(option => option.value === next)
    if (!found?.preset) return
    const cmp = compareEnabled ? resolveCmpDp(cmpPeriod, found.preset) : undefined
    onApply({ date_preset: found.preset }, found.label, cmp?.dp, cmp?.label)
  }

  function applyCustomMain() {
    if (!since || !until) return alert('Selecione as duas datas.')
    if (since > until) return alert('A data inicial deve ser antes da data final.')
    const label = `${fmtBr(since)} - ${fmtBr(until)}`
    const cmp = compareEnabled ? resolveCmpDp(cmpPeriod, 'custom', since, until) : undefined
    onApply({ time_range: JSON.stringify({ since, until }) }, label, cmp?.dp, cmp?.label)
  }

  function handleCmpChange(next: string) {
    setCmpPeriod(next)
    if (next === 'custom') {
      const today = new Date().toISOString().slice(0, 10)
      const base = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      setCmpSince(base)
      setCmpUntil(today)
      return
    }
    const main = getMainDp()
    if (!main) return
    const cmp = resolveCmpDp(next, main.preset, main.since, main.until)
    if (cmp) onApply(main.dp, main.label, cmp.dp, cmp.label)
  }

  function applyCustomCmp() {
    if (!cmpSince || !cmpUntil) return alert('Selecione as duas datas de comparação.')
    if (cmpSince > cmpUntil) return alert('A data inicial deve ser antes da data final.')
    const main = getMainDp()
    if (!main) return alert('Aplique o período principal primeiro.')
    const label = `${fmtBr(cmpSince)} - ${fmtBr(cmpUntil)}`
    onApply(main.dp, main.label, { time_range: JSON.stringify({ since: cmpSince, until: cmpUntil }) }, label)
  }

  function toggleCompare() {
    const next = !compareEnabled
    setCompareEnabled(next)
    const main = getMainDp()
    if (!main) return
    if (!next) {
      onApply(main.dp, main.label)
      return
    }
    const cmp = resolveCmpDp(cmpPeriod, main.preset, main.since, main.until)
    if (cmp) onApply(main.dp, main.label, cmp.dp, cmp.label)
  }

  return (
    <div className={styles.wrap}>
      <FilterSelect
        caption="Período principal"
        value={period}
        options={PRESETS}
        onChange={handleMainChange}
      />

      {period === 'custom' && (
        <div className={styles.rangeEditor}>
          <DateRangeField
            since={since}
            until={until}
            onChange={(nextSince, nextUntil) => {
              setSince(nextSince)
              setUntil(nextUntil)
            }}
            ariaLabel="Período personalizado"
            caption="Período"
          />
          <button className={styles.applyBtn} onClick={applyCustomMain}>Aplicar</button>
        </div>
      )}

      <button
        type="button"
        className={`${styles.compareBtn} ${compareEnabled ? styles.compareBtnActive : ''}`}
        onClick={toggleCompare}
      >
        <span className={styles.compareBtnDot} />
        {compareEnabled ? 'Comparando períodos' : 'Comparar períodos'}
      </button>

      {compareEnabled && (
        <div className={styles.comparePanel}>
          <span className={styles.compareLabel}>Comparação</span>
          <FilterSelect
            caption="Comparar com"
            value={cmpPeriod}
            options={CMP_PRESETS}
            onChange={handleCmpChange}
          />

          {cmpPeriod === 'custom' && (
            <div className={styles.rangeEditor}>
              <DateRangeField
                since={cmpSince}
                until={cmpUntil}
                onChange={(nextSince, nextUntil) => {
                  setCmpSince(nextSince)
                  setCmpUntil(nextUntil)
                }}
                ariaLabel="Período de comparação"
                caption="Período"
              />
              <button className={styles.applyBtn} onClick={applyCustomCmp}>Aplicar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
