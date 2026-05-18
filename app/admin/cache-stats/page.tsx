'use client'

// Painel admin de telemetria de cache. Acesso role=admin via edge function
// admin-cache-stats. Sem dep externa de UI — usa apenas estilo inline pra
// não inflar bundle com módulo CSS pra uma tela rara.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { efCall } from '@/lib/api'
import { getSession } from '@/lib/auth'

interface CacheStatsByEndpoint {
  endpoint: string
  hits: number
  misses: number
  last_hit_at: string | null
  last_miss_at: string | null
  avg_payload_kb: number | null
}

interface CacheTopKey {
  key: string
  expires_in_seconds: number
  age_seconds: number
}

interface CacheStatsResponse {
  ok: boolean
  gc_removed?: number
  summary: {
    total_hits: number
    total_misses: number
    hit_rate: number
    active_entries: number
    expired_entries: number
  }
  by_endpoint: CacheStatsByEndpoint[]
  top_keys: CacheTopKey[]
  error?: string
}

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR')
}

function formatPercent(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

function formatRelative(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export default function CacheStatsPage() {
  const router = useRouter()
  const [data, setData] = useState<CacheStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [gcLoading, setGcLoading] = useState(false)

  const load = useCallback(async (opts?: { gc?: boolean }) => {
    setLoading(true)
    setError('')
    try {
      const res = await efCall('admin-cache-stats', { gc: opts?.gc ? 1 : 0 })
      const typed = res as unknown as CacheStatsResponse
      if (typed.error) {
        setError(typed.error)
        return
      }
      setData(typed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro de rede')
    } finally {
      setLoading(false)
      setGcLoading(false)
    }
  }, [])

  useEffect(() => {
    const sess = getSession()
    if (!sess) {
      router.replace('/login?next=/admin/cache-stats')
      return
    }
    load()
  }, [load, router])

  const handleGc = async () => {
    if (!confirm('Apagar entradas expiradas do cache? Próximas requests vão buscar dados frescos da API.')) return
    setGcLoading(true)
    await load({ gc: true })
  }

  if (loading && !data) {
    return <div style={{ padding: 40, fontFamily: 'Sora, sans-serif' }}>Carregando…</div>
  }

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: 'Sora, sans-serif', color: '#CC1414' }}>
        Erro: {error}
        <div style={{ marginTop: 12 }}>
          <button onClick={() => load()} style={btnStyle('primary')}>Tentar novamente</button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { summary, by_endpoint, top_keys } = data

  return (
    <div style={{ padding: 40, fontFamily: 'Sora, sans-serif', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>📊 Cache Stats</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => load()} style={btnStyle('secondary')}>↻ Atualizar</button>
          <button onClick={handleGc} disabled={gcLoading} style={btnStyle('danger')}>
            {gcLoading ? '⟳ Limpando…' : '🗑 Limpar expirados'}
          </button>
        </div>
      </div>

      {data.gc_removed !== undefined && data.gc_removed > 0 && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', color: '#92400E', padding: 12, borderRadius: 8, marginBottom: 16 }}>
          ✓ {data.gc_removed} entrada(s) expirada(s) removida(s)
        </div>
      )}

      {/* Sumário em cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 32 }}>
        <StatCard label="Hit rate" value={formatPercent(summary.hit_rate)} accent={summary.hit_rate > 0.6 ? '#16A34A' : summary.hit_rate > 0.3 ? '#D97706' : '#CC1414'} />
        <StatCard label="Total hits" value={formatNumber(summary.total_hits)} />
        <StatCard label="Total misses" value={formatNumber(summary.total_misses)} />
        <StatCard label="Entradas ativas" value={formatNumber(summary.active_entries)} />
        <StatCard label="Expiradas (lixo)" value={formatNumber(summary.expired_entries)} accent={summary.expired_entries > 500 ? '#D97706' : undefined} />
      </div>

      {/* Por endpoint */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Por endpoint</h2>
        {by_endpoint.length === 0 ? (
          <div style={{ color: '#6E6E73', fontSize: 13 }}>Sem dados ainda. O cache começa a coletar stats após o primeiro uso em produção.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#F9FAFB', textAlign: 'left' }}>
                <th style={thStyle}>Endpoint</th>
                <th style={thStyle}>Hits</th>
                <th style={thStyle}>Misses</th>
                <th style={thStyle}>Hit rate</th>
                <th style={thStyle}>Payload médio</th>
                <th style={thStyle}>Último hit</th>
              </tr>
            </thead>
            <tbody>
              {by_endpoint.map((row) => {
                const total = row.hits + row.misses
                const rate = total > 0 ? row.hits / total : 0
                return (
                  <tr key={row.endpoint} style={{ borderBottom: '1px solid #F2F2F7' }}>
                    <td style={tdStyle}><code>{row.endpoint}</code></td>
                    <td style={tdStyle}>{formatNumber(row.hits)}</td>
                    <td style={tdStyle}>{formatNumber(row.misses)}</td>
                    <td style={{ ...tdStyle, color: rate > 0.6 ? '#16A34A' : rate > 0.3 ? '#D97706' : '#CC1414', fontWeight: 700 }}>
                      {formatPercent(rate)}
                    </td>
                    <td style={tdStyle}>{row.avg_payload_kb ? `${row.avg_payload_kb.toFixed(1)} KB` : '—'}</td>
                    <td style={{ ...tdStyle, color: '#6E6E73', fontSize: 11 }}>
                      {row.last_hit_at ? new Date(row.last_hit_at).toLocaleString('pt-BR') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* Top keys ativas */}
      <section>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Top 10 entries ativas (mais recentes)</h2>
        {top_keys.length === 0 ? (
          <div style={{ color: '#6E6E73', fontSize: 13 }}>Nenhuma entry ativa no momento.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F9FAFB', textAlign: 'left' }}>
                <th style={thStyle}>Cache key</th>
                <th style={thStyle}>Idade</th>
                <th style={thStyle}>Expira em</th>
              </tr>
            </thead>
            <tbody>
              {top_keys.map((k) => (
                <tr key={k.key} style={{ borderBottom: '1px solid #F2F2F7' }}>
                  <td style={tdStyle}><code style={{ fontSize: 11 }}>{k.key}</code></td>
                  <td style={tdStyle}>{formatRelative(k.age_seconds)} atrás</td>
                  <td style={tdStyle}>{formatRelative(k.expires_in_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div style={{ marginTop: 40, padding: 16, background: '#F9FAFB', borderRadius: 8, fontSize: 12, color: '#6E6E73', lineHeight: 1.6 }}>
        <strong>Dicas de leitura:</strong>
        <ul style={{ margin: '8px 0 0 16px' }}>
          <li><b>Hit rate &gt; 60%</b>: cache está pegando bem. Cada hit = ~2s economizados de Meta API.</li>
          <li><b>Hit rate &lt; 30%</b>: pouca reutilização. TTL muito curto ou tráfego muito disperso.</li>
          <li><b>Expiradas &gt; 500</b>: GC não rodou recentemente. Pode rodar manual aqui ou aguardar cron.</li>
          <li>Stats locais (memória/localStorage) NÃO aparecem aqui — só cache compartilhado no Postgres.</li>
        </ul>
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E5EA', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 11, color: '#6E6E73', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || '#1d1d1f', marginTop: 6 }}>{value}</div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 700,
  color: '#3A3A3C',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '.04em',
}
const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  color: '#1d1d1f',
}

function btnStyle(variant: 'primary' | 'secondary' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: '1px solid',
  }
  if (variant === 'primary') return { ...base, background: '#1877F2', color: '#fff', borderColor: '#1877F2' }
  if (variant === 'danger') return { ...base, background: '#fff', color: '#CC1414', borderColor: '#FCA5A5' }
  return { ...base, background: '#fff', color: '#3A3A3C', borderColor: '#E5E5EA' }
}
