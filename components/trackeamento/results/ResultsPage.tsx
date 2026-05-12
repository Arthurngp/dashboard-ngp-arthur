'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as DB from '@/lib/trackeamento/db';
import { TRACKEAMENTO_BASE_PATH } from '@/lib/trackeamento/constants';
import { useToast } from '@/hooks/trackeamento/useToast';
import type { NGPForm, FormField, FormResponse, FieldType, FormSession } from '@/types/trackeamento';
import styles from './ResultsPage.module.css';

const TYPE_LABELS: Partial<Record<FieldType, string>> = {
  short_text: 'Texto curto', long_text: 'Texto longo', email: 'E-mail', phone: 'Telefone',
  number: 'Número', url: 'URL', multiple_choice: 'Múltipla escolha', checkbox: 'Checkbox',
  dropdown: 'Dropdown', yes_no: 'Sim / Não', rating: 'Avaliação', opinion_scale: 'Escala',
  date: 'Data', file_upload: 'Upload', welcome: 'Boas-vindas', statement: 'Texto',
  group: 'Grupo',
};

/** Returns the traffic channel based on UTM params stored in a response. */
const PAID_MEDIUMS = ['cpc','paid','paid-social','paid_social','paidsocial','cpm','display','ppc','remarketing','social_paid'];

function getChannel(answers: FormResponse['answers']): 'Anúncio' | 'Orgânico' | 'Direto' {
  const medium = String(answers['__utm_medium']?.value || '').toLowerCase().trim();
  const source = String(answers['__utm_source']?.value || '').toLowerCase().trim();
  const campaign = String(answers['__utm_campaign']?.value || '').toLowerCase().trim();
  const hasAnyUtm = medium || source || campaign;
  if (!hasAnyUtm) return 'Direto';
  if (PAID_MEDIUMS.some(m => medium.includes(m))) return 'Anúncio';
  return 'Orgânico';
}

const CHANNEL_STYLE: Record<string, React.CSSProperties> = {
  'Anúncio':  { background: 'rgba(253,203,110,0.15)', color: '#FDCB6E', border: '1px solid rgba(253,203,110,0.3)', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  'Orgânico': { background: 'rgba(0,184,148,0.12)',   color: '#00B894', border: '1px solid rgba(0,184,148,0.3)',   borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
  'Direto':   { background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' },
};

/** Flattens group fields into their sub-fields for display in Summary/Individual/CSV. */
function flattenAnswerableFields(fields: FormField[]): FormField[] {
  const result: FormField[] = [];
  for (const field of fields) {
    if (['welcome', 'statement', 'thank_you'].includes(field.type)) continue;
    if (field.type === 'group' && field.subFields?.length) {
      for (const sf of field.subFields) {
        result.push({
          id: sf.id,
          type: sf.type,
          title: sf.placeholder,
          description: '',
          required: sf.required,
          placeholder: sf.placeholder,
        });
      }
    } else {
      result.push(field);
    }
  }
  return result;
}

export function ResultsPage({
  id,
  basePath = TRACKEAMENTO_BASE_PATH,
}: {
  id: string
  basePath?: string
}) {
  const router = useRouter();
  const { toasts, showToast } = useToast();
  const [form, setForm] = useState<NGPForm | null>(null);
  const [responses, setResponses] = useState<FormResponse[]>([]);
  const [sessions, setSessions] = useState<FormSession[]>([]);
  const [activeTab, setActiveTab] = useState<'summary' | 'individual' | 'jornada'>('summary');
  const [selectedSession, setSelectedSession] = useState<FormSession | null>(null);

  useEffect(() => {
    Promise.all([DB.getForm(id), DB.getResponses(id), DB.getSessions(id)])
      .then(([f, res, sess]) => {
        if (!f) { router.push(basePath); return; }
        setForm(f);
        document.title = `Respostas — ${f.title}`;
        setResponses(res);
        setSessions(sess);
      })
      .catch(console.error);
  }, [id, router]);

  function exportCSV() {
    if (!form || responses.length === 0) return;
    const UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
    const hasUtms = responses.some(r => UTM_KEYS.some(k => r.answers[`__${k}`]?.value));
    const ansFields = flattenAnswerableFields(form.fields);
    const headers = [
      'Data',
      'Canal',
      ...(hasUtms ? UTM_KEYS.map(k => k.replace('utm_','UTM_').toUpperCase()) : []),
      ...ansFields.map(f => f.title),
    ];
    const rows = responses.map(r => {
      const date = new Date(r.submittedAt).toLocaleString('pt-BR');
      const channel = getChannel(r.answers);
      const utmVals = hasUtms ? UTM_KEYS.map(k => String(r.answers[`__${k}`]?.value ?? '')) : [];
      const vals = ansFields.map(f => {
        const ans = r.answers[f.id];
        if (!ans) return '';
        const v = ans.value;
        if (Array.isArray(v)) return v.join('; ');
        return String(v ?? '');
      });
      return [date, channel, ...utmVals, ...vals];
    });
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${form.title.replace(/[^a-z0-9]/gi, '_')}_respostas.csv`;
    link.click();
    showToast('CSV exportado com sucesso', 'success');
  }

  if (!form) return null;

  const answerableFields = flattenAnswerableFields(form.fields);
  const total = responses.length;
  const completedSessions = sessions.filter(s => s.status === 'completed').length;
  const abandonedSessions = sessions.filter(s => s.status === 'abandoned').length;
  const completionRate = sessions.length > 0 ? Math.round((completedSessions / sessions.length) * 100) : 0;
  const avgTimeMs = sessions.filter(s => s.totalTimeMs).reduce((sum, s, _, arr) => sum + (s.totalTimeMs || 0) / arr.length, 0);

  // ── Scoring helpers ──
  const scoringEnabled = !!form.settings.enableScoring;
  const formFields = form.fields;
  function calcResponseScore(r: FormResponse): number {
    let score = 0;
    for (const field of formFields) {
      if (!field.optionScores) continue;
      const ans = r.answers[field.id];
      if (!ans || ans.value == null) continue;
      const val = ans.value;
      if (field.type === 'multiple_choice' || field.type === 'dropdown' || field.type === 'checkbox') {
        const arr = Array.isArray(val) ? val : [String(val)];
        arr.forEach(v => { score += field.optionScores![v] ?? 0; });
      } else if (field.type === 'yes_no') {
        score += field.optionScores[String(val)] ?? 0;
      } else if (field.type === 'rating' || field.type === 'opinion_scale') {
        score += field.optionScores[String(val)] ?? 0;
      }
    }
    return score;
  }
  const avgScore = scoringEnabled && total > 0
    ? responses.reduce((sum, r) => sum + calcResponseScore(r), 0) / total
    : null;

  const paidCount    = responses.filter(r => getChannel(r.answers) === 'Anúncio').length;
  const organicCount = responses.filter(r => getChannel(r.answers) === 'Orgânico').length;
  const directCount  = responses.filter(r => getChannel(r.answers) === 'Direto').length;
  const hasChannelData = paidCount > 0 || organicCount > 0;

  function fmtTime(ms: number) {
    if (!ms) return '—';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
  }

  return (
    <div className={styles.page}>
      {/* Navbar */}
      <nav className={styles.navbar}>
        <button className={styles.backBtn} onClick={() => router.push(basePath)}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 2L3 8l6 6"/></svg>
        </button>
        <span className={styles.navTitle}>{form.title}</span>
        <button className="btn btn-secondary btn-sm" onClick={exportCSV} disabled={total === 0}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 1v8M2 6l4 4 4-4"/><path d="M1 11h10"/></svg>
          Exportar CSV
        </button>
      </nav>

      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Respostas</h1>
          <p className={styles.subtitle}>{form.title}</p>
        </div>

        {/* Stats */}
        <div className={styles.stats}>
          {[
            { label: 'Respostas', value: total },
            { label: 'Sessões', value: sessions.length },
            { label: 'Taxa conclusão', value: `${completionRate}%` },
            { label: 'Tempo médio', value: fmtTime(avgTimeMs) },
            ...(avgScore !== null ? [{ label: form.settings.scoreLabel || 'Score médio', value: avgScore.toFixed(1) }] : []),
          ].map(s => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statLabel}>{s.label}</div>
              <div className={styles.statValue}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Channel breakdown bar */}
        {hasChannelData && total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Canal de origem</span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', display: 'flex', background: 'var(--bg-dark)' }}>
              {paidCount > 0 && <div style={{ width: `${(paidCount / total) * 100}%`, background: '#FDCB6E', transition: 'width 0.4s' }} title={`Anúncio: ${paidCount}`} />}
              {organicCount > 0 && <div style={{ width: `${(organicCount / total) * 100}%`, background: '#00B894', transition: 'width 0.4s' }} title={`Orgânico: ${organicCount}`} />}
              {directCount > 0 && <div style={{ width: `${(directCount / total) * 100}%`, background: 'rgba(255,255,255,0.15)', transition: 'width 0.4s' }} title={`Direto: ${directCount}`} />}
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 11, whiteSpace: 'nowrap' }}>
              {paidCount > 0 && <span style={{ color: '#FDCB6E', fontWeight: 700 }}>● Anúncio {paidCount} ({Math.round((paidCount/total)*100)}%)</span>}
              {organicCount > 0 && <span style={{ color: '#00B894', fontWeight: 700 }}>● Orgânico {organicCount} ({Math.round((organicCount/total)*100)}%)</span>}
              {directCount > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>● Direto {directCount} ({Math.round((directCount/total)*100)}%)</span>}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className={styles.tabs}>
          <button className={`${styles.tabBtn}${activeTab === 'summary' ? ' ' + styles.active : ''}`} onClick={() => setActiveTab('summary')}>Resumo</button>
          <button className={`${styles.tabBtn}${activeTab === 'individual' ? ' ' + styles.active : ''}`} onClick={() => setActiveTab('individual')}>Individuais</button>
          <button className={`${styles.tabBtn}${activeTab === 'jornada' ? ' ' + styles.active : ''}`} onClick={() => setActiveTab('jornada')}>Jornada</button>
        </div>

        {total === 0 && (
          <div className={styles.empty}>
            <svg width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><rect x="6" y="6" width="44" height="44" rx="6"/><line x1="18" y1="22" x2="38" y2="22"/><line x1="18" y1="30" x2="38" y2="30"/><line x1="18" y1="38" x2="28" y2="38"/></svg>
            <h3>Nenhuma resposta ainda</h3>
            <p>Compartilhe o link do formulário para começar a coletar respostas</p>
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}${basePath}/view/${id}`);
              showToast('Link copiado', 'success');
            }}>
              Copiar link
            </button>
          </div>
        )}

        {/* Summary */}
        {activeTab === 'summary' && total > 0 && (
          <div className={styles.summaryList}>
            {answerableFields.map(field => (
              <div key={field.id} className={styles.summaryCard}>
                <div className={styles.summaryCardHeader}>
                  <div className={styles.summaryFieldType}>{TYPE_LABELS[field.type] || field.type}</div>
                  <div className={styles.summaryFieldTitle}>{field.title}</div>
                </div>
                <FieldSummary field={field} responses={responses} total={total} />
              </div>
            ))}
          </div>
        )}

        {/* Journey / Tracking */}
        {activeTab === 'jornada' && (
          <JourneyTab
            form={form}
            sessions={sessions}
            completedSessions={completedSessions}
            abandonedSessions={abandonedSessions}
            fmtTime={fmtTime}
            onSelectSession={setSelectedSession}
          />
        )}

        {/* Individual */}
        {activeTab === 'individual' && total > 0 && (() => {
          const UTM_KEYS = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
          const hasUtms = responses.some(r => UTM_KEYS.some(k => r.answers[`__${k}`]?.value));
          return (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Data</th>
                    <th>Canal</th>
                    {hasUtms && UTM_KEYS.map(k => <th key={k} style={{ color: 'var(--warning)', fontSize: 11 }}>{k.replace('utm_','').toUpperCase()}</th>)}
                    {answerableFields.map(f => <th key={f.id}>{f.title}</th>)}
                    {scoringEnabled && <th>{form.settings.scoreLabel || 'Score'}</th>}
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{new Date(r.submittedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                      <td><span style={CHANNEL_STYLE[getChannel(r.answers)]}>{getChannel(r.answers)}</span></td>
                      {hasUtms && UTM_KEYS.map(k => {
                        const v = r.answers[`__${k}`]?.value;
                        return <td key={k} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v ? String(v) : '—'}</td>;
                      })}
                      {answerableFields.map(f => {
                        const ans = r.answers[f.id];
                        const v = ans?.value;
                        const display = Array.isArray(v) ? v.join(', ') : v != null ? String(v) : '—';
                        return <td key={f.id} title={display}>{display}</td>;
                      })}
                      {scoringEnabled && <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{calcResponseScore(r)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Session detail modal */}
      {selectedSession && (
        <div className="modal-overlay active" onClick={() => setSelectedSession(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16 }}>Detalhes da sessão</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedSession(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>Início: {new Date(selectedSession.startedAt).toLocaleString('pt-BR')}</span>
              {selectedSession.totalTimeMs && <span>Duração: {fmtTime(selectedSession.totalTimeMs)}</span>}
              <span className={`status-pill ${selectedSession.status === 'completed' ? 'pill-completed' : selectedSession.status === 'abandoned' ? 'pill-abandoned' : 'pill-progress'}`}>
                {selectedSession.status === 'completed' ? 'Concluído' : selectedSession.status === 'abandoned' ? 'Abandonou' : 'Em andamento'}
              </span>
            </div>
            <div className={styles.sessionSteps}>
              {selectedSession.steps.map((step, i) => (
                <div key={step.fieldId} className={styles.sessionStep}>
                  <div className={styles.stepNum}>{i + 1}</div>
                  <div className={styles.stepInfo}>
                    <div className={styles.stepTitle}>{step.fieldTitle}</div>
                    <div className={styles.stepMeta}>
                      {step.timeToAnswerMs ? `${fmtTime(step.timeToAnswerMs)}` : 'Sem resposta'}
                      {step.revisits > 0 && ` · voltou ${step.revisits}×`}
                    </div>
                    {step.answer !== undefined && step.answer !== null && (
                      <div className={styles.stepAnswer}>
                        {Array.isArray(step.answer) ? step.answer.join(', ') : String(step.answer)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {selectedSession.steps.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>Nenhuma etapa registrada.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
      </div>
    </div>
  );
}

/* ── Journey tab ── */
function JourneyTab({
  form, sessions, completedSessions, abandonedSessions, fmtTime, onSelectSession,
}: {
  form: NGPForm;
  sessions: FormSession[];
  completedSessions: number;
  abandonedSessions: number;
  fmtTime: (ms: number) => string;
  onSelectSession: (s: FormSession) => void;
}) {
  const fields = form.fields.filter(f => !['welcome', 'statement', 'thank_you'].includes(f.type));
  const totalSessions = sessions.length;

  if (totalSessions === 0) {
    return (
      <div className={styles.empty} style={{ marginTop: 40 }}>
        <h3>Nenhuma sessão registrada</h3>
        <p>Quando alguém abrir o formulário, as sessões aparecerão aqui.</p>
      </div>
    );
  }

  // Funnel: count sessions that reached each field
  const funnelData = fields.map(field => {
    const count = sessions.filter(s => s.steps.some(step => step.fieldId === field.id)).length;
    return { field, count, pct: totalSessions > 0 ? Math.round((count / totalSessions) * 100) : 0 };
  });

  // Avg time per field
  const timeData = fields.map(field => {
    const times = sessions
      .flatMap(s => s.steps)
      .filter(step => step.fieldId === field.id && step.timeToAnswerMs != null)
      .map(step => step.timeToAnswerMs as number);
    const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
    return { field, avgMs: avg };
  });
  const maxAvgMs = Math.max(...timeData.map(d => d.avgMs), 1);

  const COLORS = ['#6C5CE7', '#0984E3', '#00B894', '#FDCB6E', '#E17055', '#FD79A8'];

  return (
    <div>
      {/* Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 28 }}>
        {[
          { label: 'Concluíram', value: completedSessions, color: 'var(--success)' },
          { label: 'Abandonaram', value: abandonedSessions, color: 'var(--danger)' },
          { label: 'Taxa de conclusão', value: `${totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0}%`, color: 'var(--primary)' },
        ].map(s => (
          <div key={s.label} className={styles.statCard}>
            <div className={styles.statValue} style={{ color: s.color }}>{s.value}</div>
            <div className={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Funnel */}
      {funnelData.length > 0 && (
        <div className={styles.journeySection}>
          <h3 className={styles.journeyTitle}>Funil de conversão</h3>
          {funnelData.map((d, i) => (
            <div key={d.field.id} className={styles.funnelRow}>
              <span className={styles.funnelLabel} title={d.field.title}>{d.field.title}</span>
              <div className={styles.funnelTrack}>
                <div
                  className={styles.funnelFill}
                  style={{ width: `${d.pct}%`, background: COLORS[i % COLORS.length] }}
                >
                  {d.pct > 10 ? `${d.count}` : ''}
                </div>
              </div>
              <span className={styles.funnelPct}>{d.pct}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Time per question */}
      {timeData.some(d => d.avgMs > 0) && (
        <div className={styles.journeySection}>
          <h3 className={styles.journeyTitle}>Tempo médio por pergunta</h3>
          {timeData.filter(d => d.avgMs > 0).map((d) => (
            <div key={d.field.id} className={styles.timeRow}>
              <span className={styles.timeLabel} title={d.field.title}>{d.field.title}</span>
              <div className={styles.timeTrack}>
                <div className={styles.timeFill} style={{ width: `${(d.avgMs / maxAvgMs) * 100}%` }} />
              </div>
              <span className={styles.timeVal}>{fmtTime(d.avgMs)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sessions table */}
      <div className={styles.journeySection}>
        <h3 className={styles.journeyTitle}>Sessões individuais</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Início</th>
              <th>Duração</th>
              <th>Perguntas vistas</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s, i) => (
              <tr key={s.id} onClick={() => onSelectSession(s)} style={{ cursor: 'pointer' }}>
                <td>{i + 1}</td>
                <td>{new Date(s.startedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{s.totalTimeMs ? fmtTime(s.totalTimeMs) : '—'}</td>
                <td>{s.steps.length} / {fields.length}</td>
                <td>
                  <span className={`status-pill ${s.status === 'completed' ? 'pill-completed' : s.status === 'abandoned' ? 'pill-abandoned' : 'pill-progress'}`}>
                    {s.status === 'completed' ? 'Concluiu' : s.status === 'abandoned' ? 'Abandonou' : 'Em andamento'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CHART_COLORS = ['#6C5CE7', '#0984E3', '#00B894', '#E17055', '#FDCB6E', '#E84393', '#00CEC9', '#74B9FF'];

/* ── Donut / pie chart ── */
function PieChart({ data, colors }: { data: { label: string; count: number }[]; colors: string[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) return null;
  const cx = 80, cy = 80, r = 65, ri = 34;
  function toXY(angle: number, radius: number): [number, number] {
    const rad = (angle - 90) * Math.PI / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }
  if (data.length === 1) return (
    <svg width={160} height={160} viewBox="0 0 160 160">
      <circle cx={cx} cy={cy} r={r} fill={colors[0]} />
      <circle cx={cx} cy={cy} r={ri} fill="var(--bg-card)" />
    </svg>
  );
  let start = 0;
  return (
    <svg width={160} height={160} viewBox="0 0 160 160">
      {data.map((d, i) => {
        const sweep = (d.count / total) * 360;
        const [x1, y1] = toXY(start, r);
        const [x2, y2] = toXY(start + sweep, r);
        const [xi1, yi1] = toXY(start, ri);
        const [xi2, yi2] = toXY(start + sweep, ri);
        const large = sweep > 180 ? 1 : 0;
        start += sweep;
        return (
          <path
            key={i}
            d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ri} ${ri} 0 ${large} 0 ${xi1} ${yi1} Z`}
            fill={colors[i % colors.length]}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={ri} fill="var(--bg-card)" />
    </svg>
  );
}

/* ── Field summary per type ── */
function FieldSummary({ field, responses, total }: { field: NGPForm['fields'][0]; responses: FormResponse[]; total: number }) {
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar');
  const values = responses.map(r => r.answers[field.id]?.value).filter(v => v != null && v !== '' && !(Array.isArray(v) && v.length === 0));

  if (values.length === 0) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sem respostas</p>;

  // Choice fields → bar or pie chart
  if (['multiple_choice', 'checkbox', 'dropdown', 'yes_no', 'picture_choice'].includes(field.type)) {
    const counts: Record<string, number> = {};
    values.forEach(v => {
      const arr = Array.isArray(v) ? v : [v];
      arr.forEach(item => { counts[String(item)] = (counts[String(item)] || 0) + 1; });
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;
    const btnStyle = (active: boolean) => ({
      fontSize: 11, fontWeight: 600 as const, padding: '3px 10px', borderRadius: 5, cursor: 'pointer' as const,
      border: '1px solid var(--border)', background: active ? 'var(--primary)' : 'transparent',
      color: active ? '#fff' : 'var(--text-muted)', transition: 'all 0.15s',
    });
    return (
      <div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button style={btnStyle(chartType === 'bar')} onClick={() => setChartType('bar')}>Barras</button>
          <button style={btnStyle(chartType === 'pie')} onClick={() => setChartType('pie')}>Pizza</button>
        </div>
        {chartType === 'bar' ? (
          <div className={styles.barList}>
            {sorted.map(([label, count], i) => (
              <div key={label} className={styles.barRow}>
                <span className={styles.barLabel}>{label}</span>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${(count / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                </div>
                <span className={styles.barCount}>{count}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <PieChart data={sorted.map(([label, count]) => ({ label, count }))} colors={CHART_COLORS} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sorted.map(([label, count], i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 2 }}>{count} ({Math.round((count / values.length) * 100)}%)</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Rating / opinion scale → average + distribution bar
  if (['rating', 'opinion_scale'].includes(field.type)) {
    const nums = values.map(v => Number(v)).filter(n => !isNaN(n));
    const avg = nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : '—';
    const max = field.type === 'rating' ? (field.maxRating || 5) : (field.maxValue || 10);
    const counts: Record<number, number> = {};
    nums.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
    const maxCount = Math.max(...Object.values(counts), 1);
    return (
      <div>
        <div className={styles.avgDisplay}>
          <span className={styles.avgBig}>{avg}</span>
          <span className={styles.avgSub}>/ {max} · {nums.length} respostas</span>
        </div>
        <div className={styles.barList} style={{ marginTop: 12 }}>
          {Array.from({ length: max }, (_, i) => i + 1).map(n => (
            <div key={n} className={styles.barRow}>
              <span className={styles.barLabel} style={{ minWidth: 16 }}>{n}</span>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${((counts[n] || 0) / maxCount) * 100}%` }} />
              </div>
              <span className={styles.barCount}>{counts[n] || 0}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Text fields → sample list
  const samples = (values as string[]).filter(Boolean).slice(0, 6);
  return (
    <div className={styles.textSamples}>
      {samples.map((s, i) => <div key={i} className={styles.textSample}>{String(s)}</div>)}
      {values.length > 6 && <div className={styles.textSample} style={{ color: 'var(--text-muted)' }}>+{values.length - 6} respostas</div>}
    </div>
  );
}
