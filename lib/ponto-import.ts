import * as XLSX from 'xlsx'

export type TipoBatida =
  | 'entrada'
  | 'saida_almoco'
  | 'retorno_almoco'
  | 'saida'
  | 'extra'
  | 'ausencia'

export interface BatidaParseada {
  nome_planilha: string          // Nome como veio no arquivo (ex: "RODRIGO")
  data_iso: string               // YYYY-MM-DD
  hora_iso?: string | null       // HH:MM:SS ou null se ausência
  tipo_registro: TipoBatida
  observacao?: string | null     // FOLGA / FERIADO / DOMINGO etc.
  source_row: number             // Linha da planilha para debug
}

export interface PontoParseResult {
  ok: boolean
  error?: string
  batidas: BatidaParseada[]
  nomesUnicos: string[]
  // Diagnóstico
  totalLinhas: number
  linhasIgnoradas: number
  periodo?: { inicio: string; fim: string }
}

const HEADER_HINTS = {
  data: ['data'],
  nome: ['nome', 'colaborador'],
  entrada: ['entrada'],
  saida_almoco: ['saída intervalo', 'saida intervalo', 'almoço', 'almoco'],
  retorno_almoco: ['retorno intervalo', 'retorno'],
  saida: ['saída', 'saida'],
}

const ABSENCE_MARKERS = ['folga', 'feriado', 'domingo', 'sabado', 'sábado', 'ferias', 'férias', 'atestado', 'falta']

function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function findHeaderRow(rows: any[][]): number {
  // Procura linha que tenha 'data' E 'nome' (ou colaborador)
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] || []
    const cells = row.map(norm)
    const hasData = cells.some(c => c === 'data')
    const hasNome = cells.some(c => c.includes('nome') || c.includes('colaborador'))
    if (hasData && hasNome) return i
  }
  return -1
}

function findColIndex(headers: string[], candidates: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i])
    if (!h) continue
    for (const cand of candidates) {
      const c = norm(cand)
      // Match exato OU h contém c (mais flexível)
      if (h === c) return i
      if (h.includes(c) && c.length >= 4) return i
    }
  }
  return -1
}

function parseDateCell(value: any): string | null {
  if (!value && value !== 0) return null
  if (value instanceof Date) {
    // Quando vier como Date (CSV ou raw=false), assume UTC=valor literal.
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'number') {
    // Serial Excel: usa o utilitário do SheetJS.
    const d = XLSX.SSF.parse_date_code(value)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(value).trim()
  // DD/MM/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

function parseTimeCell(value: any): string | null {
  if (value == null) return null
  if (typeof value === 'number') {
    // Fração do dia (Excel time). Ex: 0.3333 → 08:00.
    // Pode ser >= 1 quando a célula tem data+hora (parte fracionária só).
    const frac = value - Math.floor(value)
    const totalSec = Math.round(frac * 86400)
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0')
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0')
    const ss = String(totalSec % 60).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  if (value instanceof Date) {
    // Date pode ter sofrido drift (SheetJS converte fração de dia em data Epoch
    // local, depois adiciona offset). Usar UTC mas considerar drift de seg-1900.
    // Mais confiável: parseTimeCell preferencialmente recebe number cru.
    const hh = String(value.getUTCHours()).padStart(2, '0')
    const mm = String(value.getUTCMinutes()).padStart(2, '0')
    const ss = String(value.getUTCSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
  const s = String(value).trim()
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)
  if (m) return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}:${(m[3] || '00').padStart(2, '0')}`
  return null
}

/**
 * Lê arquivo XLSX/CSV e devolve batidas estruturadas.
 * Cada linha da planilha (1 colaborador + 1 dia) pode gerar até 4 batidas:
 * entrada, saida_almoco, retorno_almoco, saida.
 * Se a coluna Entrada tiver texto tipo FOLGA/FERIADO/DOMINGO, gera 1
 * batida tipo='ausencia' com observacao=marcador (sem horário).
 */
export async function parsePontoFile(file: File): Promise<PontoParseResult> {
  const buf = await file.arrayBuffer()
  let wb: XLSX.WorkBook
  try {
    // cellDates: false → mantém valores como número (serial date / fração de dia).
    // Isso evita o drift de fuso/segundos que SheetJS introduz ao converter
    // frações de dia em Date pré-1970.
    wb = XLSX.read(buf, { type: 'array', cellDates: false })
  } catch (e: any) {
    return { ok: false, error: `Não foi possível abrir o arquivo: ${e?.message || e}`, batidas: [], nomesUnicos: [], totalLinhas: 0, linhasIgnoradas: 0 }
  }

  // Usa a primeira aba (planilhas de ponto típicas têm 1 só).
  const sheetName = wb.SheetNames[0]
  if (!sheetName) {
    return { ok: false, error: 'Arquivo sem abas.', batidas: [], nomesUnicos: [], totalLinhas: 0, linhasIgnoradas: 0 }
  }
  const ws = wb.Sheets[sheetName]
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

  const headerIdx = findHeaderRow(rows)
  if (headerIdx < 0) {
    return { ok: false, error: 'Cabeçalho não encontrado. Esperado: Data + Nome (Colaborador).', batidas: [], nomesUnicos: [], totalLinhas: rows.length, linhasIgnoradas: 0 }
  }
  const headers = rows[headerIdx].map(c => String(c ?? ''))

  const iData = findColIndex(headers, HEADER_HINTS.data)
  const iNome = findColIndex(headers, HEADER_HINTS.nome)
  const iEnt = findColIndex(headers, HEADER_HINTS.entrada)
  const iSA = findColIndex(headers, HEADER_HINTS.saida_almoco)
  const iRA = findColIndex(headers, HEADER_HINTS.retorno_almoco)
  const iSai = findColIndex(headers, HEADER_HINTS.saida)

  if (iData < 0 || iNome < 0) {
    return { ok: false, error: 'Colunas obrigatórias ausentes (Data, Nome).', batidas: [], nomesUnicos: [], totalLinhas: rows.length, linhasIgnoradas: 0 }
  }

  const batidas: BatidaParseada[] = []
  const nomes = new Set<string>()
  let ignoradas = 0
  let totalLinhasDados = 0
  let dataMin: string | null = null
  let dataMax: string | null = null

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) { continue }
    const nome = row[iNome] != null ? String(row[iNome]).trim() : ''
    const dataIso = parseDateCell(row[iData])
    if (!nome || !dataIso) { continue }
    totalLinhasDados++
    nomes.add(nome)
    if (!dataMin || dataIso < dataMin) dataMin = dataIso
    if (!dataMax || dataIso > dataMax) dataMax = dataIso

    const entVal = row[iEnt]
    const entHora = parseTimeCell(entVal)
    const entStr = entVal != null ? String(entVal).trim() : ''
    const entStrNorm = norm(entStr)

    // Caso ausência: célula Entrada tem texto tipo FOLGA/FERIADO/DOMINGO
    if (!entHora && entStr && ABSENCE_MARKERS.some(m => entStrNorm.includes(m))) {
      batidas.push({
        nome_planilha: nome,
        data_iso: dataIso,
        hora_iso: null,
        tipo_registro: 'ausencia',
        observacao: entStr.toUpperCase(),
        source_row: r + 1,
      })
      continue
    }

    // Caso normal: até 4 batidas por linha
    const pushIf = (hora: string | null, tipo: TipoBatida) => {
      if (!hora) return
      batidas.push({
        nome_planilha: nome,
        data_iso: dataIso,
        hora_iso: hora,
        tipo_registro: tipo,
        observacao: null,
        source_row: r + 1,
      })
    }
    pushIf(entHora, 'entrada')
    pushIf(iSA >= 0 ? parseTimeCell(row[iSA]) : null, 'saida_almoco')
    pushIf(iRA >= 0 ? parseTimeCell(row[iRA]) : null, 'retorno_almoco')
    pushIf(iSai >= 0 ? parseTimeCell(row[iSai]) : null, 'saida')

    // Linha sem nenhum horário e sem marcador: ignorada
    if (!entHora && !batidas.length) ignoradas++
  }

  return {
    ok: true,
    batidas,
    nomesUnicos: Array.from(nomes).sort(),
    totalLinhas: totalLinhasDados,
    linhasIgnoradas: ignoradas,
    periodo: dataMin && dataMax ? { inicio: dataMin, fim: dataMax } : undefined,
  }
}

/**
 * Resolve cada nome da planilha para um usuario_id do sistema, baseado no
 * mapping definido pelo usuário. Marca batidas sem mapping como erro.
 */
export interface BatidaPronta extends BatidaParseada {
  usuario_id: string | null
  created_at_iso: string  // YYYY-MM-DDTHH:mm:ss (ou T12:00:00 para ausência)
}

export function aplicarMapping(
  batidas: BatidaParseada[],
  mapping: Record<string, string>, // nome_planilha -> usuario_id
): BatidaPronta[] {
  return batidas.map(b => {
    const usuario_id = mapping[b.nome_planilha] || null
    const hora = b.hora_iso || '12:00:00'
    return {
      ...b,
      usuario_id,
      created_at_iso: `${b.data_iso}T${hora}`,
    }
  })
}
