'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as Storage from '@/lib/trackeamento/storage';
import * as DB from '@/lib/trackeamento/db';
import { TRACKEAMENTO_BASE_PATH } from '@/lib/trackeamento/constants';
import { useToast } from '@/hooks/trackeamento/useToast';
import type { NGPForm } from '@/types/trackeamento';
import styles from './DashboardPage.module.css';

// ---- Icons ----
const Icon = {
  Logo: () => (
    <svg width="18" height="18" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
      <rect x="2" y="2" width="6" height="6" rx="1.5" /><rect x="10" y="2" width="6" height="6" rx="1.5" />
      <rect x="2" y="10" width="6" height="6" rx="1.5" /><rect x="10" y="10" width="6" height="6" rx="1.5" />
    </svg>
  ),
  Plus: () => (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="7" y1="1" x2="7" y2="13" /><line x1="1" y1="7" x2="13" y2="7" />
    </svg>
  ),
  Search: () => (
    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="6" cy="6" r="4.5" /><line x1="10" y1="10" x2="13" y2="13" />
    </svg>
  ),
  Edit: () => (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2l2 2-7 7H1V9l7-7z" />
    </svg>
  ),
  Copy: () => (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1" /><path d="M7 3V1H1v6h2" />
    </svg>
  ),
  Chart: () => (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="1" y="7" width="3" height="5" /><rect x="5" y="4" width="3" height="8" /><rect x="9" y="1" width="3" height="11" />
    </svg>
  ),
  Link: () => (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 7a3 3 0 004.5.4l2-2a3 3 0 00-4.2-4.2L5.8 2.5" />
      <path d="M7 5a3 3 0 00-4.5-.4l-2 2a3 3 0 004.2 4.2L6.2 9.5" />
    </svg>
  ),
  Trash: () => (
    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 3 11 3" /><path d="M9 3V1H3v2" /><path d="M9 3l-.7 8H3.7L3 3" />
    </svg>
  ),
  Form: () => (
    <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="4" y="4" width="32" height="32" rx="4" /><line x1="10" y1="14" x2="30" y2="14" />
      <line x1="10" y1="20" x2="30" y2="20" /><line x1="10" y1="26" x2="22" y2="26" />
    </svg>
  ),
  EmptyForm: () => (
    <svg width="64" height="64" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="8" y="8" width="48" height="48" rx="6" /><line x1="18" y1="24" x2="46" y2="24" />
      <line x1="18" y1="32" x2="46" y2="32" /><line x1="18" y1="40" x2="32" y2="40" />
    </svg>
  ),
};

const PALETTE = ['#6C5CE7', '#0984E3', '#00B894', '#E17055', '#FDCB6E', '#E84393', '#00CEC9'];

export function DashboardPage({
  basePath = TRACKEAMENTO_BASE_PATH,
  showNavbar = true,
}: {
  basePath?: string
  showNavbar?: boolean
}) {
  const router = useRouter();
  const { toasts, showToast } = useToast();
  const [forms, setForms] = useState<NGPForm[]>([]);
  const [responseCounts, setResponseCounts] = useState<Record<string, number>>({});
  const [totalResponses, setTotalResponses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadForms = useCallback(async () => {
    setLoading(true);
    try {
      const [all, counts] = await Promise.all([
        DB.getForms(),
        DB.getAllResponseCounts(),
      ]);
      all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setForms(all);
      setResponseCounts(counts);
      setTotalResponses(Object.values(counts).reduce((s, n) => s + n, 0));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadForms(); }, [loadForms]);

  const stats = {
    total: forms.length,
    published: forms.filter((f) => f.published).length,
    responses: totalResponses,
  };

  const filtered = search
    ? forms.filter((f) => f.title.toLowerCase().includes(search.toLowerCase()))
    : forms;

  async function createNew() {
    try {
      const form = Storage.createBlankForm();
      await DB.saveForm(form);
      router.push(`${basePath}/builder?id=${form.id}`);
    } catch (err) {
      console.error('Erro ao criar formulário:', err);
      showToast('Erro ao criar formulário. Verifique o console.', 'error');
    }
  }

  async function handleDuplicate(id: string) {
    await DB.duplicateForm(id);
    await loadForms();
    showToast('Formulário duplicado', 'success');
  }

  async function handleDelete(id: string) {
    await DB.deleteForm(id);
    setDeleteTarget(null);
    await loadForms();
    showToast('Formulário excluído', 'info');
  }

  function handleShare(id: string) {
    const url = `${window.location.origin}${basePath}/view/${id}`;
    navigator.clipboard.writeText(url).then(() => showToast('Link copiado', 'success'));
  }

  return (
    <div className={styles.page}>
      {/* Navbar */}
      {showNavbar && (
        <nav className={styles.navbar}>
          <div className={styles.brand}>
            <div className={styles.logo}><Icon.Logo /></div>
            NGP Forms
          </div>
          <button className="btn btn-primary btn-sm" onClick={createNew}>
            <Icon.Plus /> Novo formulário
          </button>
        </nav>
      )}

      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h1 className={styles.title}>Formulários</h1>
            <p className={styles.subtitle}>Crie e gerencie seus formulários interativos</p>
          </div>
        </div>

        {/* Stats */}
        <div className={styles.stats}>
          {[
            { label: 'Formulários', value: stats.total },
            { label: 'Publicados', value: stats.published },
            { label: 'Respostas', value: stats.responses },
          ].map((s) => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statLabel}>{s.label}</div>
              <div className={styles.statValue}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Section header */}
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Todos</h2>
          <div className={styles.searchBox}>
            <Icon.Search />
            <input
              type="text"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={styles.searchInput}
            />
          </div>
        </div>

        {/* Grid */}
        <div className={styles.grid}>
          {/* New form card */}
          <button className={styles.newCard} onClick={createNew}>
            <div className={styles.newCardIcon}><Icon.Plus /></div>
            <span>Novo formulário</span>
          </button>

          {loading && (
            <div className={styles.empty} style={{ gridColumn: '1/-1' }}>
              <p>Carregando...</p>
            </div>
          )}

          {!loading && filtered.length === 0 && search && (
            <div className={styles.empty} style={{ gridColumn: '1/-1' }}>
              <Icon.EmptyForm />
              <h3>Nenhum resultado</h3>
              <p>Sem formulários para &quot;{search}&quot;</p>
            </div>
          )}

          {!loading && filtered.length === 0 && !search && (
            <div className={styles.empty} style={{ gridColumn: '1/-1' }}>
              <Icon.EmptyForm />
              <h3>Nenhum formulário ainda</h3>
              <p>Crie seu primeiro formulário</p>
              <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={createNew}>
                Criar formulário
              </button>
            </div>
          )}

          {filtered.map((form, i) => {
            const color = form.theme?.primaryColor || PALETTE[i % PALETTE.length];
            const responseCount = responseCounts[form.id] ?? 0;
            const fieldCount = form.fields?.length || 0;
            const date = new Date(form.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

            return (
              <div
                key={form.id}
                className={styles.formCard}
                onClick={() => router.push(`${basePath}/builder?id=${form.id}`)}
              >
                {/* Actions */}
                <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                  <button title="Editar" onClick={() => router.push(`${basePath}/builder?id=${form.id}`)}><Icon.Edit /></button>
                  <button title="Duplicar" onClick={() => handleDuplicate(form.id)}><Icon.Copy /></button>
                  <button title="Respostas" onClick={() => router.push(`${basePath}/results/${form.id}`)}><Icon.Chart /></button>
                  <button title="Compartilhar" onClick={() => handleShare(form.id)}><Icon.Link /></button>
                  <button className={styles.deleteBtn} title="Excluir" onClick={() => setDeleteTarget(form.id)}><Icon.Trash /></button>
                </div>

                {/* Preview */}
                <div className={styles.cardPreview} style={{ background: `${color}18` }}>
                  <div style={{ color, opacity: 0.4 }}><Icon.Form /></div>
                </div>

                {/* Body */}
                <div className={styles.cardBody}>
                  <h3 className={styles.cardTitle}>{form.title}</h3>
                  <span className={`badge ${form.published ? 'badge-success' : 'badge-warning'}`}>
                    {form.published ? 'Publicado' : 'Rascunho'}
                  </span>
                  <div className={styles.cardMeta}>
                    <span>{fieldCount} {fieldCount === 1 ? 'pergunta' : 'perguntas'}</span>
                    <span>{responseCount} {responseCount === 1 ? 'resposta' : 'respostas'}</span>
                    <span>{date}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete Modal */}
      {deleteTarget && (
        <div className="modal-overlay active" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Excluir formulário?</h2>
            <p className="text-secondary" style={{ fontSize: 14, marginTop: 8 }}>
              Esta ação não pode ser desfeita. Todas as respostas também serão excluídas.
            </p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancelar</button>
              <button className="btn btn-danger" onClick={() => handleDelete(deleteTarget)}>Excluir</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </div>
  );
}
