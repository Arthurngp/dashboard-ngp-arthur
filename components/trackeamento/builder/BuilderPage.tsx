'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import * as Storage from '@/lib/trackeamento/storage';
import * as DB from '@/lib/trackeamento/db';
import { TRACKEAMENTO_BASE_PATH } from '@/lib/trackeamento/constants';
import { useToast } from '@/hooks/trackeamento/useToast';
import type { NGPForm, FormField, FieldType, FieldLogicRule, HiddenField, SubField } from '@/types/trackeamento';
import styles from './BuilderPage.module.css';

const FlowEditor = dynamic(
  () => import('./FlowEditor').then(m => m.FlowEditor),
  { ssr: false, loading: () => <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Carregando editor de fluxo…</div> }
);

/* ── Icons ── */
const I = {
  Back: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 2L3 8l6 6"/></svg>,
  Grip: () => <svg width="12" height="12" fill="currentColor" viewBox="0 0 12 12"><circle cx="4" cy="3" r="1.2"/><circle cx="8" cy="3" r="1.2"/><circle cx="4" cy="6" r="1.2"/><circle cx="8" cy="6" r="1.2"/><circle cx="4" cy="9" r="1.2"/><circle cx="8" cy="9" r="1.2"/></svg>,
  Trash: () => <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 3 10 3"/><path d="M8 3V1H3v2"/><path d="M8 3l-.6 7H4.6L4 3"/></svg>,
  Plus: () => <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>,
  Eye: () => <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z"/><circle cx="7" cy="7" r="1.8"/></svg>,
  Mobile: () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="1" width="8" height="12" rx="2"/><line x1="6.5" y1="10" x2="7.5" y2="10"/></svg>,
  Refresh: () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5A6 6 0 1 0 7 11"/><path d="M12 1v4h-4"/></svg>,
  Close: () => <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>,
  EmptyCanvas: () => <svg width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><rect x="6" y="6" width="44" height="44" rx="6"/><line x1="14" y1="20" x2="42" y2="20"/><line x1="14" y1="28" x2="42" y2="28"/><line x1="14" y1="36" x2="28" y2="36"/></svg>,
  EmptyRight: () => <svg width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M22 8l14 14-14 14"/><line x1="8" y1="22" x2="36" y2="22"/></svg>,
  Palette: () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="6.5" cy="6.5" r="5.5"/><circle cx="6.5" cy="3.5" r="1"/><circle cx="9.5" cy="8" r="1"/><circle cx="3.5" cy="8" r="1"/></svg>,
  Settings: () => <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="6.5" cy="6.5" r="2"/><path d="M6.5 1v2M6.5 10v2M1 6.5h2M10 6.5h2M2.5 2.5l1.5 1.5M8.5 8.5l1.5 1.5M2.5 10.5l1.5-1.5M8.5 4.5l1.5-1.5"/></svg>,
};

/* ── Field type definitions ── */
type FieldDef = { type: FieldType; label: string; icon: JSX.Element };
const FIELD_CATEGORIES: { label: string; items: FieldDef[] }[] = [
  {
    label: 'Texto',
    items: [
      { type: 'short_text', label: 'Texto curto', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="4" x2="13" y2="4"/><line x1="1" y1="8" x2="9" y2="8"/></svg> },
      { type: 'long_text', label: 'Texto longo', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="3" x2="13" y2="3"/><line x1="1" y1="6" x2="13" y2="6"/><line x1="1" y1="9" x2="13" y2="9"/><line x1="1" y1="12" x2="8" y2="12"/></svg> },
      { type: 'email', label: 'E-mail', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="3" width="12" height="8" rx="1"/><path d="M1 4l6 4 6-4"/></svg> },
      { type: 'phone', label: 'Telefone', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="1" width="8" height="12" rx="2"/><line x1="7" y1="10" x2="7" y2="10.5"/></svg> },
      { type: 'number', label: 'Número', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="10" x2="13" y2="10"/><path d="M4 10V5l-2 1.5"/><path d="M8 5h3l-3 4h3"/></svg> },
      { type: 'url', label: 'URL', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 9a3 3 0 004.5.4l2-2a3 3 0 00-4.2-4.2L6 4.5"/><path d="M9 5a3 3 0 00-4.5-.4l-2 2a3 3 0 004.2 4.2L8 9.5"/></svg> },
    ],
  },
  {
    label: 'Escolha',
    items: [
      { type: 'multiple_choice', label: 'Múltipla escolha', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="3" cy="4" r="1.5"/><line x1="7" y1="4" x2="13" y2="4"/><circle cx="3" cy="10" r="1.5"/><line x1="7" y1="10" x2="13" y2="10"/></svg> },
      { type: 'checkbox', label: 'Checkbox', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="3" width="4" height="4" rx="1"/><line x1="7" y1="5" x2="13" y2="5"/><rect x="1" y="9" width="4" height="4" rx="1"/><line x1="7" y1="11" x2="13" y2="11"/></svg> },
      { type: 'dropdown', label: 'Dropdown', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="3" width="12" height="8" rx="1"/><path d="M4 6.5l3 3 3-3"/></svg> },
      { type: 'yes_no', label: 'Sim / Não', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 7l3 3 7-7"/></svg> },
    ],
  },
  {
    label: 'Escala',
    items: [
      { type: 'rating', label: 'Avaliação', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1l1.5 3.5H12l-2.8 2 1 3.5L7 8 4.8 10l1-3.5L3 4.5h3.5z"/></svg> },
      { type: 'opinion_scale', label: 'Escala', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="10" x2="13" y2="10"/><circle cx="4" cy="10" r="1.5" fill="currentColor"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/><circle cx="10" cy="4" r="1.5" fill="currentColor"/></svg> },
    ],
  },
  {
    label: 'Outros',
    items: [
      { type: 'date', label: 'Data', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="2" width="12" height="11" rx="1"/><line x1="1" y1="6" x2="13" y2="6"/><line x1="4" y1="1" x2="4" y2="3"/><line x1="10" y1="1" x2="10" y2="3"/></svg> },
      { type: 'file_upload', label: 'Upload', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1v8M4 4l3-3 3 3"/><path d="M1 11v2h12v-2"/></svg> },
      { type: 'group', label: 'Grupo', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="4" x2="13" y2="4"/><line x1="1" y1="8" x2="13" y2="8"/><rect x="1" y="11" width="12" height="2" rx="1"/></svg> },
      { type: 'welcome', label: 'Boas-vindas', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="1" width="12" height="12" rx="2"/><line x1="4" y1="7" x2="10" y2="7"/><line x1="7" y1="4" x2="7" y2="10"/></svg> },
      { type: 'statement', label: 'Texto', icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="1" width="12" height="12" rx="2"/><line x1="4" y1="5" x2="10" y2="5"/><line x1="4" y1="8" x2="8" y2="8"/></svg> },
    ],
  },
];

const TYPE_LABELS: Partial<Record<FieldType, string>> = {
  short_text: 'Texto curto', long_text: 'Texto longo', email: 'E-mail', phone: 'Telefone',
  number: 'Número', url: 'URL', multiple_choice: 'Múltipla escolha', checkbox: 'Checkbox',
  dropdown: 'Dropdown', yes_no: 'Sim / Não', rating: 'Avaliação', opinion_scale: 'Escala',
  date: 'Data', file_upload: 'Upload', welcome: 'Boas-vindas', statement: 'Texto', thank_you: 'Obrigado',
  picture_choice: 'Imagem', group: 'Grupo de campos',
};

/* ── Main component ── */
export function BuilderPage({ basePath = TRACKEAMENTO_BASE_PATH }: { basePath?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toasts, showToast } = useToast();

  const [form, setForm] = useState<NGPForm | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'build' | 'flow' | 'theme' | 'settings'>('build');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [showMobilePreview, setShowMobilePreview] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const dragSrcIdx = useRef<number | null>(null);

  /* load form */
  useEffect(() => {
    const id = params.get('id');
    if (!id) {
      if (params.get('new') === '1') {
        const blank = Storage.createBlankForm();
        DB.saveForm(blank).then((saved) => {
          router.replace(`${basePath}/builder?id=${saved.id}`);
        });
        return;
      }
      router.push(basePath);
      return;
    }
    DB.getForm(id).then(existing => {
      if (existing) { setForm(existing); }
      else {
        const blank = { ...Storage.createBlankForm(), id };
        DB.saveForm(blank).then(saved => setForm(saved));
      }
    });
  }, [basePath, params, router]);

  /* auto-save */
  useEffect(() => {
    if (!form) return;
    setSaveStatus('saving');
    const t = setTimeout(() => {
      DB.saveForm(form)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('idle'));
    }, 700);
    return () => clearTimeout(t);
  }, [form]);

  const updateForm = useCallback((patch: Partial<NGPForm>) => {
    setForm(prev => prev ? { ...prev, ...patch } : prev);
  }, []);

  const updateField = useCallback((id: string, patch: Partial<FormField>) => {
    setForm(prev => {
      if (!prev) return prev;
      return { ...prev, fields: prev.fields.map(f => f.id === id ? { ...f, ...patch } : f) };
    });
  }, []);

  function addField(type: FieldType) {
    if (!form) return;
    const field = Storage.createField(type);
    const fields = [...form.fields, field];
    updateForm({ fields });
    setSelectedId(field.id);
    setActiveTab('build');
    setTimeout(() => {
      document.getElementById('canvas-end')?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }

  // addField variant used from the Flow editor — stays in flow tab
  function addFieldFromFlow(type: FieldType) {
    if (!form) return;
    const field = Storage.createField(type);
    updateForm({ fields: [...form.fields, field] });
  }

  function removeField(id: string) {
    if (!form) return;
    const fields = form.fields.filter(f => f.id !== id);
    updateForm({ fields });
    if (selectedId === id) setSelectedId(null);
  }

  /* drag-drop */
  function onDragStart(e: React.DragEvent, idx: number) {
    dragSrcIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  }
  function onDrop(e: React.DragEvent, dropIdx: number) {
    e.preventDefault();
    const src = dragSrcIdx.current;
    if (src === null || src === dropIdx || !form) { cleanup(); return; }
    const arr = [...form.fields];
    const [moved] = arr.splice(src, 1);
    arr.splice(dropIdx, 0, moved);
    updateForm({ fields: arr });
    cleanup();
  }
  function cleanup() { dragSrcIdx.current = null; setDragOverIdx(null); }

  const selectedField = form?.fields.find(f => f.id === selectedId) ?? null;

  if (!form) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
      Carregando...
    </div>
  );

  return (
    <div className={styles.layout}>
      {/* ── TopBar ── */}
      <header className={styles.topbar}>
        <button className={styles.backBtn} onClick={() => router.push(basePath)} title="Voltar">
          <I.Back />
        </button>
        <input
          className={styles.titleInput}
          value={form.title}
          onChange={e => updateForm({ title: e.target.value })}
          placeholder="Título do formulário"
        />
        <div className={styles.tabs}>
          {(['build', 'flow', 'theme', 'settings'] as const).map(t => (
            <button key={t} className={`${styles.tabBtn}${activeTab === t ? ' ' + styles.active : ''}`} onClick={() => setActiveTab(t)}>
              {t === 'build' ? 'Perguntas' : t === 'flow' ? 'Fluxo' : t === 'theme' ? 'Tema' : 'Config'}
            </button>
          ))}
        </div>
        <div title={saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? 'Salvo' : ''} className={`${styles.statusDot}${saveStatus === 'saving' ? ' ' + styles.saving : saveStatus === 'saved' ? ' ' + styles.saved : ''}`} />
        <button className="btn btn-ghost btn-sm" onClick={() => { setShowMobilePreview(true); setPreviewKey(k => k + 1); }}>
          <I.Mobile /> Preview
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.open(`${basePath}/view/${form.id}?preview=1`, '_blank')}>
          <I.Eye /> Pré-visualizar
        </button>
        <button
          className={`btn ${form.published ? 'btn-secondary' : 'btn-primary'} btn-sm ${styles.publishBtn}`}
          onClick={() => { updateForm({ published: !form.published }); showToast(form.published ? 'Formulário despublicado' : 'Formulário publicado!', form.published ? 'info' : 'success'); }}
        >
          {form.published ? 'Despublicar' : 'Publicar'}
        </button>
      </header>

      {/* ── Left Panel ── */}
      <aside className={styles.leftPanel}>
        {FIELD_CATEGORIES.map(cat => (
          <div key={cat.label} className={styles.panelSection}>
            <div className={styles.panelLabel}>{cat.label}</div>
            <div className={styles.fieldTypeGrid}>
              {cat.items.map(({ type, label, icon }) => (
                <button key={type} className={styles.fieldTypeBtn} onClick={() => addField(type)}>
                  <span className={styles.fieldTypeBtnIcon}>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      {/* ── Canvas ── */}
      <main
        className={styles.canvas}
        style={activeTab === 'flow'
          ? { gridColumn: '2 / 4', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }
          : {}}
      >
        {activeTab === 'flow' ? (
          <FlowEditor
            form={form}
            updateField={updateField}
            addField={addFieldFromFlow}
            onSelectField={(id) => { setSelectedId(id); setActiveTab('build'); }}
          />
        ) : form.fields.length === 0 ? (
          <div className={styles.canvasEmpty}>
            <I.EmptyCanvas />
            <p>Clique em um tipo de campo<br />ao lado para adicionar</p>
          </div>
        ) : (
          form.fields.map((field, idx) => (
            <div
              key={field.id}
              draggable
              onDragStart={e => onDragStart(e, idx)}
              onDragOver={e => onDragOver(e, idx)}
              onDrop={e => onDrop(e, idx)}
              onDragEnd={cleanup}
              onClick={() => { setSelectedId(field.id); setActiveTab('build'); }}
              className={[
                styles.fieldItem,
                selectedId === field.id ? styles.selected : '',
                dragOverIdx === idx ? styles.dragOver : '',
              ].join(' ')}
            >
              <span className={styles.fieldItemDrag}><I.Grip /></span>
              <span className={styles.fieldItemIcon}>
                {FIELD_CATEGORIES.flatMap(c => c.items).find(i => i.type === field.type)?.icon}
              </span>
              <div className={styles.fieldItemBody}>
                <div className={styles.fieldItemType}>{TYPE_LABELS[field.type]}</div>
                <div className={styles.fieldItemTitle}>{field.title || '(sem título)'}</div>
              </div>
              {field.logic && field.logic.length > 0 && (
                <span title="Lógica condicional ativa" style={{ fontSize: 10, color: 'var(--primary)', background: 'rgba(108,92,231,0.15)', borderRadius: 4, padding: '1px 5px', marginRight: 4 }}>
                  lógica
                </span>
              )}
              <span className={styles.fieldItemNum}>{idx + 1}</span>
              <button className={styles.fieldItemDelete} onClick={e => { e.stopPropagation(); removeField(field.id); }}>
                <I.Trash />
              </button>
            </div>
          ))
        )}
        <div id="canvas-end" />
      </main>

      {/* ── Right Panel ── */}
      {activeTab === 'flow' ? null : <aside className={styles.rightPanel}>
        {activeTab === 'build' && !selectedField && (
          <div className={styles.noField}>
            <I.EmptyRight />
            <p>Selecione um campo para<br />editar suas propriedades</p>
          </div>
        )}
        {activeTab === 'build' && selectedField && (
          <FieldSettingsPanel
            field={selectedField}
            allFields={form.fields}
            update={(p) => updateField(selectedField.id, p)}
            hiddenFields={form.settings.hiddenFields || []}
            enableScoring={!!form.settings.enableScoring}
          />
        )}
        {activeTab === 'theme' && <ThemePanel form={form} update={updateForm} />}
        {activeTab === 'settings' && <FormSettingsPanel form={form} update={updateForm} fields={form.fields} />}
      </aside>}

      {/* Mobile preview overlay */}
      {showMobilePreview && (
        <div className={styles.previewOverlay} onClick={() => setShowMobilePreview(false)}>
          <div className={styles.phoneFrame} onClick={e => e.stopPropagation()}>
            <div className={styles.phoneTop}>
              <div className={styles.phoneNotch} />
            </div>
            <iframe
              key={previewKey}
              src={`${basePath}/view/${form.id}?preview=1`}
              className={styles.phoneScreen}
              title="Preview mobile"
            />
            <div className={styles.phoneBottom}>
              <div className={styles.phoneHomeBar} />
            </div>
          </div>
          <div className={styles.previewActions}>
            <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); setPreviewKey(k => k + 1); }}>
              <I.Refresh /> Recarregar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowMobilePreview(false)}>
              <I.Close /> Fechar
            </button>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t => <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>)}
      </div>
    </div>
  );
}

/* ── (FlowView replaced by FlowEditor in FlowEditor.tsx) ── */

/* ── Variable inserter dropdown ── */
function VariableInserter({
  allFields,
  hiddenFields,
  currentFieldId,
  onInsert,
}: {
  allFields: FormField[];
  hiddenFields: HiddenField[];
  currentFieldId: string;
  onInsert: (variable: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentIdx = allFields.findIndex(f => f.id === currentFieldId);
  const prevFields = allFields.slice(0, currentIdx);

  const variables: { label: string; value: string }[] = [
    ...hiddenFields.map(hf => ({ label: `[oculto] ${hf.name}`, value: `{{${hf.name}}}` })),
    ...prevFields.map(f => ({ label: f.title || '(sem título)', value: `{{${f.title || f.id}}}` })),
  ];

  if (variables.length === 0) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 11, color: 'var(--primary)', background: 'transparent', border: '1px solid var(--primary)', borderRadius: 4, padding: '2px 7px', cursor: 'pointer', marginTop: 4 }}
      >
        {'{ }'} Inserir variável
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, minWidth: 180, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', marginTop: 4 }}>
          {variables.map(v => (
            <button
              key={v.value}
              type="button"
              onClick={() => { onInsert(v.value); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: 12, color: 'var(--text-primary)', background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
            >
              <span style={{ fontFamily: 'monospace', color: 'var(--primary)', marginRight: 6 }}>{v.value}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{v.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Field settings panel ── */
function FieldSettingsPanel({ field, allFields, update, hiddenFields, enableScoring }: {
  field: FormField;
  allFields: FormField[];
  update: (p: Partial<FormField>) => void;
  hiddenFields: HiddenField[];
  enableScoring: boolean;
}) {
  const showOptions = ['multiple_choice', 'checkbox', 'dropdown', 'picture_choice'].includes(field.type);
  const showPlaceholder = ['short_text', 'long_text', 'email', 'phone', 'number', 'url'].includes(field.type);
  const isLayout = ['welcome', 'statement', 'thank_you'].includes(field.type);
  const showScoring = enableScoring && ['multiple_choice', 'yes_no', 'rating', 'opinion_scale', 'dropdown'].includes(field.type);

  function insertIntoTitle(v: string) { update({ title: (field.title || '') + v }); }
  function insertIntoDesc(v: string) { update({ description: (field.description || '') + v }); }

  return (
    <div className={styles.settingsBody}>
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Título</label>
        <textarea className="input" rows={2} value={field.title} onChange={e => update({ title: e.target.value })} placeholder="Título do campo" />
        <VariableInserter allFields={allFields} hiddenFields={hiddenFields} currentFieldId={field.id} onInsert={insertIntoTitle} />
      </div>

      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Texto de apoio</label>
        <textarea className="input" rows={2} value={field.description || ''} onChange={e => update({ description: e.target.value })} placeholder="Ex: Sua consulta é gratuita e sem compromisso." />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
          Aparece abaixo do título. Se deixar o <strong style={{ color: 'var(--text-secondary)' }}>título vazio</strong>, exibe apenas este texto pequeno no topo do campo.
        </div>
        <VariableInserter allFields={allFields} hiddenFields={hiddenFields} currentFieldId={field.id} onInsert={insertIntoDesc} />
      </div>

      {showPlaceholder && (
        <div className={styles.settingsGroup}>
          <label className={styles.settingsLabel}>Placeholder</label>
          <input className="input" value={field.placeholder || ''} onChange={e => update({ placeholder: e.target.value })} />
        </div>
      )}

      {showOptions && (
        <>
          <hr className={styles.settingsDivider} />
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Opções</label>
            {(field.options || []).map((opt, i) => (
              <div key={i} className={styles.optionRow}>
                <input
                  className={styles.optionInput}
                  value={opt}
                  onChange={e => {
                    const opts = [...(field.options || [])];
                    const oldOpt = opts[i];
                    opts[i] = e.target.value;
                    update({ options: opts });
                    // rename optionScores key if it exists
                    if (field.optionScores && oldOpt in field.optionScores) {
                      const scores = { ...field.optionScores };
                      scores[e.target.value] = scores[oldOpt];
                      delete scores[oldOpt];
                      update({ optionScores: scores });
                    }
                  }}
                />
                {showScoring && (
                  <input
                    type="number"
                    placeholder="pts"
                    style={{ width: 54, marginLeft: 4, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text-primary)', padding: '4px 6px', fontSize: 12 }}
                    value={field.optionScores?.[opt] ?? ''}
                    onChange={e => {
                      const scores = { ...(field.optionScores || {}) };
                      const val = e.target.value === '' ? undefined : Number(e.target.value);
                      if (val === undefined) delete scores[opt]; else scores[opt] = val;
                      update({ optionScores: scores });
                    }}
                  />
                )}
                <button className={styles.optionDelBtn} onClick={() => {
                  const opts = (field.options || []).filter((_, j) => j !== i);
                  update({ options: opts });
                }}>
                  <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
                </button>
              </div>
            ))}
            <button className={styles.addOptionBtn} onClick={() => update({ options: [...(field.options || []), `Opção ${(field.options?.length || 0) + 1}`] })}>
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>
              Adicionar opção
            </button>
          </div>
          {field.type !== 'dropdown' && (
            <div className={styles.settingsRow}>
              <span className={styles.settingsRowLabel}>Permitir "Outro"</span>
              <label className="toggle"><input type="checkbox" checked={!!field.allowOther} onChange={e => update({ allowOther: e.target.checked })} /><span className="slider" /></label>
            </div>
          )}
        </>
      )}

      {/* ── Scoring for yes_no ── */}
      {showScoring && field.type === 'yes_no' && (
        <>
          <hr className={styles.settingsDivider} />
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Pontuação</label>
            {[{ key: 'Sim', label: 'Sim' }, { key: 'Não', label: 'Não' }].map(({ key, label }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, minWidth: 30, color: 'var(--text-primary)' }}>{label}</span>
                <input
                  type="number"
                  placeholder="pts"
                  style={{ width: 70, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text-primary)', padding: '4px 6px', fontSize: 12 }}
                  value={field.optionScores?.[key] ?? ''}
                  onChange={e => {
                    const scores = { ...(field.optionScores || {}) };
                    const val = e.target.value === '' ? undefined : Number(e.target.value);
                    if (val === undefined) delete scores[key]; else scores[key] = val;
                    update({ optionScores: scores });
                  }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Scoring for rating / opinion_scale ── */}
      {showScoring && (field.type === 'rating' || field.type === 'opinion_scale') && (
        <>
          <hr className={styles.settingsDivider} />
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Pontuação por valor</label>
            {(() => {
              const nums = field.type === 'rating'
                ? Array.from({ length: field.maxRating || 5 }, (_, i) => String(i + 1))
                : Array.from({ length: (field.maxValue ?? 10) - (field.minValue ?? 0) + 1 }, (_, i) => String((field.minValue ?? 0) + i));
              return nums.map(n => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, minWidth: 24, color: 'var(--text-primary)' }}>{n}</span>
                  <input
                    type="number"
                    placeholder="pts"
                    style={{ width: 70, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-dark)', color: 'var(--text-primary)', padding: '4px 6px', fontSize: 12 }}
                    value={field.optionScores?.[n] ?? ''}
                    onChange={e => {
                      const scores = { ...(field.optionScores || {}) };
                      const val = e.target.value === '' ? undefined : Number(e.target.value);
                      if (val === undefined) delete scores[n]; else scores[n] = val;
                      update({ optionScores: scores });
                    }}
                  />
                </div>
              ));
            })()}
          </div>
        </>
      )}

      {field.type === 'rating' && (
        <>
          <hr className={styles.settingsDivider} />
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Número de estrelas</label>
            <input className="input" type="number" min={3} max={10} value={field.maxRating || 5} onChange={e => update({ maxRating: parseInt(e.target.value) })} />
            <div className={styles.ratingPreview}>
              {Array.from({ length: field.maxRating || 5 }).map((_, i) => (
                <span key={i} className={styles.starBtn}>★</span>
              ))}
            </div>
          </div>
        </>
      )}

      {field.type === 'opinion_scale' && (
        <>
          <hr className={styles.settingsDivider} />
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Valor mínimo</label>
            <input className="input" type="number" value={field.minValue ?? 1} onChange={e => update({ minValue: parseInt(e.target.value) })} />
          </div>
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Valor máximo</label>
            <input className="input" type="number" value={field.maxValue ?? 10} onChange={e => update({ maxValue: parseInt(e.target.value) })} />
          </div>
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Rótulo mínimo</label>
            <input className="input" value={field.minLabel || ''} onChange={e => update({ minLabel: e.target.value })} />
          </div>
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Rótulo máximo</label>
            <input className="input" value={field.maxLabel || ''} onChange={e => update({ maxLabel: e.target.value })} />
          </div>
        </>
      )}

      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Texto do botão</label>
        <input
          className="input"
          placeholder={isLayout ? 'Continuar' : 'OK'}
          value={field.buttonText || ''}
          onChange={e => update({ buttonText: e.target.value })}
        />
        {!isLayout && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            Deixe vazio para usar "OK". No último campo usa o texto de envio das configurações.
          </div>
        )}
      </div>

      {!isLayout && (
        <>
          <hr className={styles.settingsDivider} />
          <div className={styles.settingsRow}>
            <span className={styles.settingsRowLabel}>Obrigatório</span>
            <label className="toggle"><input type="checkbox" checked={!!field.required} onChange={e => update({ required: e.target.checked })} /><span className="slider" /></label>
          </div>
        </>
      )}

      {/* ── Group sub-fields ── */}
      {field.type === 'group' && (
        <GroupPanel field={field} update={update} />
      )}

      {/* ── Logic / Skip logic ── */}
      {['yes_no', 'multiple_choice', 'dropdown'].includes(field.type) && (
        <LogicPanel field={field} allFields={allFields} update={update} />
      )}
    </div>
  );
}

/* ── Group panel ── */
const SUB_TYPE_LABELS: Record<SubField['type'], string> = {
  short_text: 'Texto', phone: 'Telefone', email: 'E-mail',
  number: 'Número', url: 'URL', long_text: 'Texto longo',
};

function GroupPanel({ field, update }: { field: FormField; update: (p: Partial<FormField>) => void }) {
  const subs = field.subFields || [];

  function addSub() {
    const newSub: SubField = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      placeholder: `Campo ${subs.length + 1}`,
      type: 'short_text',
      required: false,
    };
    update({ subFields: [...subs, newSub] });
  }

  function updateSub(id: string, patch: Partial<SubField>) {
    update({ subFields: subs.map(s => s.id === id ? { ...s, ...patch } : s) });
  }

  function removeSub(id: string) {
    update({ subFields: subs.filter(s => s.id !== id) });
  }

  return (
    <>
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Campos do grupo</label>
        {subs.map((sf, i) => (
          <div key={sf.id} style={{ background: 'var(--bg-dark)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', flex: 1 }}>Campo {i + 1}</span>
              <button onClick={() => removeSub(sf.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 2 }}>
                <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
              </button>
            </div>
            <input
              className="input"
              style={{ marginBottom: 6, fontSize: 12 }}
              placeholder="Placeholder (ex: Seu nome)"
              value={sf.placeholder}
              onChange={e => updateSub(sf.id, { placeholder: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className="input"
                style={{ flex: 1, fontSize: 12, padding: '5px 8px' }}
                value={sf.type}
                onChange={e => updateSub(sf.id, { type: e.target.value as SubField['type'] })}
              >
                {(Object.keys(SUB_TYPE_LABELS) as SubField['type'][]).map(t => (
                  <option key={t} value={t}>{SUB_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <input type="checkbox" checked={sf.required} onChange={e => updateSub(sf.id, { required: e.target.checked })} />
                Obrig.
              </label>
            </div>
          </div>
        ))}
        <button className={styles.addOptionBtn} onClick={addSub}>
          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>
          Adicionar campo
        </button>
      </div>
    </>
  );
}

/* ── Logic panel ── */
function LogicPanel({ field, allFields, update }: { field: FormField; allFields: FormField[]; update: (p: Partial<FormField>) => void }) {
  const logic = field.logic || [];

  // conditions available for this field type
  const conditions: { value: string; label: string }[] =
    field.type === 'yes_no'
      ? [{ value: 'sim', label: 'Sim' }, { value: 'nao', label: 'Não' }]
      : (field.options || []).map(o => ({ value: o, label: o }));

  // destination options: other fields (excluding self) + submit
  const destinations = allFields
    .filter(f => f.id !== field.id)
    .map(f => ({ value: f.id, label: f.title || '(sem título)' }));
  destinations.push({ value: 'submit', label: '→ Enviar formulário' });

  function setRule(condition: string, jumpToFieldId: string) {
    const existing = logic.filter(r => r.condition !== condition);
    const updated: FieldLogicRule[] = jumpToFieldId === ''
      ? existing
      : [...existing, { condition, jumpToFieldId }];
    update({ logic: updated });
  }

  function getRule(condition: string): string {
    return logic.find(r => r.condition === condition)?.jumpToFieldId ?? '';
  }

  return (
    <>
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: 6 }}><path d="M1 3h10M1 7h6M1 11h4"/><path d="M9 9l3 3-3 3" /></svg>
          Lógica condicional
        </label>
        {conditions.map(c => (
          <div key={c.value} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 36 }}>Se</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', minWidth: 48 }}>{c.label}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
            <select
              className="input"
              style={{ fontSize: 12, padding: '5px 8px', flex: 1 }}
              value={getRule(c.value)}
              onChange={e => setRule(c.value, e.target.value)}
            >
              <option value="">Próxima pergunta</option>
              {destinations.map(d => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Sem regra definida, avança normalmente.
        </div>
      </div>
    </>
  );
}

/* ── Theme panel ── */
function ThemePanel({ form, update }: { form: NGPForm; update: (p: Partial<NGPForm>) => void }) {
  const t = form.theme;
  const set = (k: keyof typeof t, v: string) => update({ theme: { ...t, [k]: v } });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setUploadError('Máximo 5 MB'); return; }
    setUploadError('');
    setUploading(true);
    try {
      const url = await DB.uploadImage(file, form.id);
      set('backgroundImage', url);
    } catch {
      setUploadError('Erro ao fazer upload da imagem de fundo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setLogoError('Máximo 2 MB'); return; }
    setLogoError('');
    setUploadingLogo(true);
    try {
      const url = await DB.uploadImage(file, form.id);
      set('logoUrl', url);
    } catch {
      setLogoError('Erro ao fazer upload da logo.');
    } finally {
      setUploadingLogo(false);
      if (logoRef.current) logoRef.current.value = '';
    }
  }

  function removeImage() {
    if (t.backgroundImage) DB.deleteImage(t.backgroundImage).catch(() => {});
    set('backgroundImage', '');
  }

  function removeLogo() {
    if (t.logoUrl) DB.deleteImage(t.logoUrl).catch(() => {});
    set('logoUrl', '');
  }

  return (
    <div className={styles.settingsBody}>
      <div className={styles.themeGrid}>
        {([['primaryColor', 'Cor primária'], ['backgroundColor', 'Fundo'], ['textColor', 'Texto'], ['buttonColor', 'Botão'], ['choiceBorderColor', 'Linhas']] as [keyof typeof t, string][]).map(([key, label]) => (
          <div key={key} className={styles.colorGroup}>
            <span className={styles.colorLabel}>{label}</span>
            <input type="color" className={styles.colorInput} value={t[key] || '#000000'} onChange={e => set(key, e.target.value)} />
          </div>
        ))}
      </div>
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Fonte</label>
        <select className="input" value={t.fontFamily || 'Inter'} onChange={e => set('fontFamily', e.target.value)}>
          {['Inter', 'Roboto', 'Poppins', 'Lato', 'Open Sans', 'Montserrat', 'Georgia', 'Merriweather'].map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* ── Background image ── */}
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Imagem de fundo</label>

        {t.backgroundImage ? (
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {/* preview */}
            <div style={{ height: 90, backgroundImage: `url(${t.backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            <button
              type="button"
              onClick={removeImage}
              style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M1 1l8 8M9 1L1 9"/></svg>
              Remover
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            style={{ width: '100%', padding: '18px 12px', border: '2px dashed var(--border)', borderRadius: 8, background: 'transparent', color: uploading ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 13, cursor: uploading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'var(--transition)' }}
          >
            {uploading ? (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.5 2.5l1.5 1.5M8.5 8.5l1.5 1.5M2.5 11.5l1.5-1.5M8.5 5.5l1.5-1.5"/></svg>
                Enviando…
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1v8M4 4l3-3 3 3"/><path d="M1 11v2h12v-2"/></svg>
                Clique para fazer upload
              </>
            )}
          </button>
        )}

        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />

        {uploadError && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>{uploadError}</div>}
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>JPG, PNG, WebP · máx 5 MB</div>
      </div>

      {/* ── Logo ── */}
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Logo</label>

        {t.logoUrl ? (
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg-dark)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <img src={t.logoUrl} alt="Logo" style={{ height: 36, maxWidth: 120, objectFit: 'contain' }} />
            <button
              type="button"
              onClick={removeLogo}
              style={{ background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: 6, padding: '4px 8px', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M1 1l8 8M9 1L1 9"/></svg>
              Remover
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={uploadingLogo}
            onClick={() => logoRef.current?.click()}
            style={{ width: '100%', padding: '18px 12px', border: '2px dashed var(--border)', borderRadius: 8, background: 'transparent', color: uploadingLogo ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 13, cursor: uploadingLogo ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'var(--transition)' }}
          >
            {uploadingLogo ? (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: 'spin 1s linear infinite' }}><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.5 2.5l1.5 1.5M8.5 8.5l1.5 1.5M2.5 11.5l1.5-1.5M8.5 5.5l1.5-1.5"/></svg>
                Enviando…
              </>
            ) : (
              <>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1v8M4 4l3-3 3 3"/><path d="M1 11v2h12v-2"/></svg>
                Clique para fazer upload
              </>
            )}
          </button>
        )}

        <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />

        {logoError && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--danger)' }}>{logoError}</div>}
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>PNG, SVG, WebP · máx 2 MB</div>
      </div>
    </div>
  );
}

/* ── Recall token picker ── */
function RecallTokenPicker({ fields, onInsert }: { fields: FormField[]; onInsert: (token: string) => void }) {
  const tokens: Array<{ label: string; token: string }> = [];
  for (const f of fields) {
    if (['welcome', 'statement', 'thank_you'].includes(f.type)) continue;
    if (f.type === 'group' && f.subFields) {
      f.subFields.forEach(sf => {
        if (sf.placeholder) tokens.push({ label: sf.placeholder, token: `{{${sf.placeholder}}}` });
      });
    } else if (f.title) {
      tokens.push({ label: f.title, token: `{{${f.title}}}` });
    }
  }
  if (tokens.length === 0) return null;
  return (
    <select
      className="input"
      style={{ fontSize: 11, padding: '4px 8px', marginTop: 4, color: 'var(--text-muted)' }}
      value=""
      onChange={e => { if (e.target.value) onInsert(e.target.value); }}
    >
      <option value="">+ Inserir variável de recall</option>
      {tokens.map(t => (
        <option key={t.token} value={t.token}>{t.label} → {t.token}</option>
      ))}
    </select>
  );
}

/* ── Form settings panel ── */
function FormSettingsPanel({ form, update, fields }: { form: NGPForm; update: (p: Partial<NGPForm>) => void; fields: FormField[] }) {
  const s = form.settings;
  const set = (k: keyof typeof s, v: string | boolean) => update({ settings: { ...s, [k]: v } });

  const hiddenFields: HiddenField[] = s.hiddenFields || [];

  function addHiddenField() {
    const newField: HiddenField = { id: Date.now().toString(36), name: `campo${hiddenFields.length + 1}` };
    update({ settings: { ...s, hiddenFields: [...hiddenFields, newField] } });
  }

  function updateHiddenField(id: string, name: string) {
    update({ settings: { ...s, hiddenFields: hiddenFields.map(hf => hf.id === id ? { ...hf, name } : hf) } });
  }

  function removeHiddenField(id: string) {
    update({ settings: { ...s, hiddenFields: hiddenFields.filter(hf => hf.id !== id) } });
  }

  return (
    <div className={styles.settingsBody}>
      <div className={styles.settingsRow}>
        <span className={styles.settingsRowLabel}>Barra de progresso</span>
        <label className="toggle"><input type="checkbox" checked={s.showProgressBar} onChange={e => set('showProgressBar', e.target.checked)} /><span className="slider" /></label>
      </div>
      <div className={styles.settingsRow}>
        <span className={styles.settingsRowLabel}>Numerar perguntas</span>
        <label className="toggle"><input type="checkbox" checked={s.showQuestionNumbers} onChange={e => set('showQuestionNumbers', e.target.checked)} /><span className="slider" /></label>
      </div>
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Botão de envio</label>
        <input className="input" value={s.submitButtonText} onChange={e => set('submitButtonText', e.target.value)} />
      </div>
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Título de agradecimento</label>
        <input className="input" value={s.thankYouTitle} onChange={e => set('thankYouTitle', e.target.value)} />
        <RecallTokenPicker fields={fields} onInsert={token => set('thankYouTitle', s.thankYouTitle + token)} />
      </div>
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Mensagem de agradecimento</label>
        <textarea className="input" rows={3} value={s.thankYouMessage} onChange={e => set('thankYouMessage', e.target.value)} />
        <RecallTokenPicker fields={fields} onInsert={token => set('thankYouMessage', s.thankYouMessage + token)} />
      </div>
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Redirecionar para (URL)</label>
        <input className="input" placeholder="https://..." value={s.thankYouRedirectUrl || ''} onChange={e => set('thankYouRedirectUrl', e.target.value)} />
      </div>

      {/* ── Hidden Fields ── */}
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel}>Campos ocultos (Hidden Fields)</label>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
          Preencha via URL: <span style={{ fontFamily: 'monospace' }}>{`${TRACKEAMENTO_BASE_PATH}/view/id?nome=João`}</span>. Use <span style={{ fontFamily: 'monospace' }}>{'{{nome}}'}</span> nos títulos para recall.
        </div>
        {hiddenFields.map(hf => (
          <div key={hf.id} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
            <input
              className="input"
              style={{ flex: 1, fontSize: 12 }}
              value={hf.name}
              onChange={e => updateHiddenField(hf.id, e.target.value.replace(/\s/g, '_'))}
              placeholder="nome_do_campo"
            />
            <button
              type="button"
              onClick={() => removeHiddenField(hf.id)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px' }}
            >
              <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="1" y1="1" x2="8" y2="8"/><line x1="8" y1="1" x2="1" y2="8"/></svg>
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.addOptionBtn}
          onClick={addHiddenField}
        >
          <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>
          Adicionar campo oculto
        </button>
      </div>

      {/* ── Scoring / Calculator ── */}
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsRow}>
        <span className={styles.settingsRowLabel}>Ativar calculadora</span>
        <label className="toggle"><input type="checkbox" checked={!!s.enableScoring} onChange={e => set('enableScoring', e.target.checked)} /><span className="slider" /></label>
      </div>
      {s.enableScoring && (
        <>
          <div className={styles.settingsGroup}>
            <label className={styles.settingsLabel}>Rótulo do score</label>
            <input className="input" placeholder="Pontos" value={s.scoreLabel || ''} onChange={e => set('scoreLabel', e.target.value)} />
          </div>
          <div className={styles.settingsRow}>
            <span className={styles.settingsRowLabel}>Mostrar score no final</span>
            <label className="toggle"><input type="checkbox" checked={!!s.showScoreAtEnd} onChange={e => set('showScoreAtEnd', e.target.checked)} /><span className="slider" /></label>
          </div>
        </>
      )}

      {/* ── Google Tag Manager ── */}
      <hr className={styles.settingsDivider} />
      <div className={styles.settingsGroup}>
        <label className={styles.settingsLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          Google Tag Manager
        </label>
        <input
          className="input"
          placeholder="GTM-XXXXXX"
          value={s.gtmContainerId || ''}
          onChange={e => set('gtmContainerId', e.target.value.toUpperCase())}
          style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}
        />
        {s.gtmContainerId && s.gtmContainerId.match(/^GTM-[A-Z0-9]+$/) ? (
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,200,83,0.08)', border: '1px solid rgba(0,200,83,0.2)', borderRadius: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', marginBottom: 6 }}>GTM ativo — eventos disparados:</div>
            {['ngp_form_start', 'ngp_question_view', 'ngp_question_answer', 'ngp_form_complete', 'ngp_form_abandon'].map(ev => (
              <div key={ev} style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', padding: '1px 0' }}>· {ev}</div>
            ))}
          </div>
        ) : s.gtmContainerId ? (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--warning)' }}>Formato inválido — use GTM-XXXXXX</div>
        ) : (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>Cole o ID do container do GTM para ativar o rastreamento.</div>
        )}
      </div>

      {/* ── Google Sheets ── */}
      <hr className={styles.settingsDivider} />
      <SheetsPanel
        url={s.sheetsWebhookUrl || ''}
        sheetName={s.sheetsSheetName || ''}
        onChangeUrl={v => set('sheetsWebhookUrl', v)}
        onChangeSheet={v => set('sheetsSheetName', v)}
      />
    </div>
  );
}

/* ── Google Sheets panel ── */
const APPS_SCRIPT_CODE = `function doPost(e) {
  var data = JSON.parse(e.postData.contents);

  // Seleciona a aba pelo nome enviado; cria se não existir; usa ativa como fallback
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = data.sheetName || '';
  var sheet;
  if (sheetName) {
    sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
  } else {
    sheet = ss.getActiveSheet();
  }

  var utmKeys = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
  var utms = data.utms || {};
  var answers = Object.entries(data.answers || {})
    .filter(function(e){ return !e[0].startsWith('__utm_'); });

  // Monta mapa { cabeçalho: valor } para escrever na coluna certa
  var rowData = {};
  rowData['Data/Hora'] = new Date(data.submittedAt);
  rowData['ID'] = data.id;
  rowData['Canal'] = data.canal || 'Direto';
  utmKeys.forEach(function(u){
    rowData[u.replace('utm_','UTM ').toUpperCase()] = utms[u] || '';
  });
  answers.forEach(function(entry){
    var a = entry[1];
    rowData[a.fieldTitle] = Array.isArray(a.value) ? a.value.join(', ') : (a.value != null ? a.value : '');
  });
  if (data.score !== undefined && data.score !== null) {
    rowData[data.scoreLabel || 'Score'] = data.score;
  }

  var headers;
  if (sheet.getLastRow() === 0) {
    // Planilha vazia: cria cabeçalhos agora
    headers = Object.keys(rowData);
    sheet.appendRow(headers);
    sheet.getRange(1,1,1,headers.length)
      .setFontWeight('bold').setBackground('#6C5CE7').setFontColor('#ffffff');
  } else {
    // Lê cabeçalhos existentes
    headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    // Adiciona colunas novas que ainda não existem
    var newCols = Object.keys(rowData).filter(function(h){ return headers.indexOf(h) === -1; });
    if (newCols.length > 0) {
      var startCol = headers.length + 1;
      sheet.getRange(1, startCol, 1, newCols.length).setValues([newCols]);
      sheet.getRange(1, startCol, 1, newCols.length)
        .setFontWeight('bold').setBackground('#6C5CE7').setFontColor('#ffffff');
      headers = headers.concat(newCols);
    }
  }

  // Escreve os valores na ordem exata dos cabeçalhos
  var row = headers.map(function(h){ return rowData[h] !== undefined ? rowData[h] : ''; });
  sheet.appendRow(row);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

function SheetsPanel({ url, sheetName, onChangeUrl, onChangeSheet }: {
  url: string;
  sheetName: string;
  onChangeUrl: (v: string) => void;
  onChangeSheet: (v: string) => void;
}) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const isValid = url.startsWith('https://script.google.com/');

  function copyCode() {
    navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={styles.settingsGroup}>
      <label className={styles.settingsLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
        </svg>
        Google Sheets
      </label>

      <input
        className="input"
        placeholder="https://script.google.com/macros/s/..."
        value={url}
        onChange={e => onChangeUrl(e.target.value)}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />

      {isValid && (
        <>
          <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,200,83,0.08)', border: '1px solid rgba(0,200,83,0.2)', borderRadius: 6, fontSize: 11, fontWeight: 700, color: 'var(--success)' }}>
            Conectado — respostas irão direto para a planilha
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              Nome da aba <span style={{ opacity: 0.6 }}>(deixe vazio para usar a aba ativa)</span>
            </label>
            <input
              className="input"
              placeholder="Ex: Respostas"
              value={sheetName}
              onChange={e => onChangeSheet(e.target.value)}
              style={{ fontSize: 12 }}
            />
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => setShowCode(v => !v)}
        style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
      >
        <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showCode ? 'rotate(90deg)' : 'none', transition: '0.2s' }}>
          <path d="M3 2l4 4-4 4"/>
        </svg>
        {showCode ? 'Ocultar instruções' : 'Como configurar'}
      </button>

      {showCode && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <ol style={{ paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>Abra sua planilha no <strong>Google Sheets</strong></li>
            <li>Clique em <strong>Extensões → Apps Script</strong></li>
            <li>Apague o código existente e cole o código abaixo</li>
            <li>Clique em <strong>Implantar → Nova implantação</strong></li>
            <li>Tipo: <strong>App da Web</strong> · Acesso: <strong>Qualquer pessoa</strong></li>
            <li>Copie a URL e cole no campo acima</li>
          </ol>
          <div style={{ marginTop: 10, position: 'relative' }}>
            <pre style={{ background: 'var(--bg-dark)', borderRadius: 6, padding: '10px 12px', fontSize: 10, overflowX: 'auto', lineHeight: 1.6, color: 'var(--text-secondary)', border: '1px solid var(--border)', maxHeight: 180, overflowY: 'auto' }}>
              {APPS_SCRIPT_CODE}
            </pre>
            <button
              type="button"
              onClick={copyCode}
              style={{ position: 'absolute', top: 6, right: 6, background: copied ? 'rgba(0,200,83,0.15)' : 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 8px', fontSize: 10, color: copied ? 'var(--success)' : 'var(--text-secondary)', cursor: 'pointer' }}
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
