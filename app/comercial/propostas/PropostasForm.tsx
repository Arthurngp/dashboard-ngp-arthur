'use client'

import React, { useState, useRef, useEffect } from 'react';
import { Target, FileText, Download, Calculator, Package, User, CreditCard, ChevronRight, Briefcase, BarChart4, ClipboardList, Plus, Trash2, LayoutDashboard, Save, Sparkles, X, Loader2 } from 'lucide-react';
import { crmCall } from '@/lib/crm-api';
import CustomSelect from '@/components/CustomSelect';
import CustomDatePicker from '@/components/CustomDatePicker';
import s from './propostas.module.css';

export default function PropostasForm() {
  const proposalRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState({
    numeroProposta: `NGP-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000) + 1000}`,
    dataEmissao: new Date().toISOString().split('T')[0],
    validadeDias: 15,
    responsavel: '',
    clienteNome: '',
    clienteDoc: '',
    clienteContato: '',
    clienteSegmento: '',
    tipoProjeto: 'Performance/Vendas',
    dorPrincipal: '',
    faturamentoMedio: '',
    ticketMedio: '',
    investimentoMensal: '',
    canalLeads: '',
    tempoResposta: '',
    taxaConversao: '',
    crmAtual: '',
    itens: [{ id: 1, descricao: '', escopo: '', vlr_un: 0, qtd: 1 }],
    prazoContrato: '',
    condicaoPagamento: 'À vista',
    inicioPrevisto: '',
    onboardingDias: 7
  });

  const total = formData.itens.reduce((acc, item) => acc + (item.vlr_un * item.qtd), 0);

  const handleAddItem = () => {
    setFormData(prev => ({
      ...prev,
      itens: [...prev.itens, { id: Date.now(), descricao: '', escopo: '', vlr_un: 0, qtd: 1 }]
    }));
  };

  const handleRemoveItem = (id: number) => {
    if (formData.itens.length === 1) return;
    setFormData(prev => ({
      ...prev,
      itens: prev.itens.filter(item => item.id !== id)
    }));
  };

  const updateItem = (id: number, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      itens: prev.itens.map(item => item.id === id ? { ...item, [field]: value } : item)
    }));
  };

  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const AI_INSTRUCTIONS_KEY = 'ngp:proposta-ai-instructions';
  const DEFAULT_AI_INSTRUCTIONS = `Empresa: Grupo NGP (NGP + AmplaSoft).
Tom: profissional, vendedor, direto. Foco em ROI e clareza de entregaveis.
Sempre incluir: relatorio de performance, reuniao mensal de alinhamento, gestor dedicado.
Se for performance: incluir auditoria de pixel, criativos por mes, otimizacao diaria.
Se for software/site: incluir reunioes de discovery, prototipo aprovado, garantia de 30 dias pos entrega.
Setup sempre separado da mensalidade.`;

  const [aiOpen, setAiOpen] = useState(false);
  const [aiBriefing, setAiBriefing] = useState('');
  const [aiInstructions, setAiInstructions] = useState(DEFAULT_AI_INSTRUCTIONS);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiMode, setAiMode] = useState<'merge' | 'overwrite'>('merge');
  const [aiShowInstructions, setAiShowInstructions] = useState(false);

  // Modo principal da sidebar: 'manual' = formulario | 'chat' = entrevista IA
  const [sidebarMode, setSidebarMode] = useState<'manual' | 'chat'>('manual');
  type ChatMsg = { role: 'user' | 'assistant'; content: string };
  const [chatHistory, setChatHistory] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatDone, setChatDone] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(AI_INSTRUCTIONS_KEY) : null;
      if (saved !== null) setAiInstructions(saved);
    } catch {}
  }, []);

  const persistInstructions = (val: string) => {
    setAiInstructions(val);
    try { localStorage.setItem(AI_INSTRUCTIONS_KEY, val); } catch {}
  };

  const restoreDefaultInstructions = () => {
    persistInstructions(DEFAULT_AI_INSTRUCTIONS);
  };

  const handleAiFill = async () => {
    if (!aiBriefing.trim() || aiBriefing.trim().length < 10) {
      setAiError('Descreva o cliente, dor e valores em pelo menos 10 caracteres.');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await crmCall('crm-proposta-parse-ai', {
        briefing: aiBriefing.trim(),
        custom_instructions: aiInstructions.trim() || undefined,
      });
      if (res.error) {
        setAiError(res.error);
        return;
      }
      const extracted = res.extracted || {};
      setFormData(prev => {
        const next: any = { ...prev };
        const fields: (keyof typeof prev)[] = [
          'clienteNome', 'clienteDoc', 'clienteContato', 'clienteSegmento',
          'tipoProjeto', 'dorPrincipal', 'faturamentoMedio', 'ticketMedio',
          'investimentoMensal', 'canalLeads', 'tempoResposta', 'taxaConversao',
          'crmAtual', 'prazoContrato', 'condicaoPagamento', 'onboardingDias',
        ];
        for (const f of fields) {
          const val = extracted[f];
          if (val === null || val === undefined) continue;
          const currentEmpty = prev[f] === '' || prev[f] === null || prev[f] === undefined;
          if (aiMode === 'overwrite' || currentEmpty) next[f] = val;
        }
        if (Array.isArray(extracted.itens) && extracted.itens.length > 0) {
          const aiItems = extracted.itens.map((it: any, idx: number) => ({
            id: Date.now() + idx,
            descricao: it.descricao || '',
            escopo: it.escopo || '',
            vlr_un: Number(it.vlr_un) || 0,
            qtd: Number(it.qtd) || 1,
          }));
          const existingItemsEmpty = prev.itens.length === 1 && !prev.itens[0].descricao.trim() && prev.itens[0].vlr_un === 0;
          next.itens = (aiMode === 'overwrite' || existingItemsEmpty) ? aiItems : [...prev.itens, ...aiItems];
        }
        return next;
      });
      setAiOpen(false);
      setAiBriefing('');
      setSaveMsg({ type: 'ok', text: 'Proposta preenchida pela IA. Revise antes de exportar.' });
      setTimeout(() => setSaveMsg(null), 5000);
    } catch (e: any) {
      setAiError(e?.message || 'Erro ao chamar a IA.');
    } finally {
      setAiLoading(false);
    }
  };

  const validateForm = (): string | null => {
    if (!formData.clienteNome.trim()) return 'Preencha o nome do cliente.'
    if (!formData.responsavel.trim()) return 'Preencha o responsável.'
    const invalidItems = formData.itens.filter(i => !i.descricao.trim() || i.vlr_un <= 0 || i.qtd <= 0)
    if (invalidItems.length > 0) return 'Todos os itens precisam de descrição, valor e quantidade válidos.'
    if (total <= 0) return 'O valor total deve ser maior que zero.'
    return null
  }

  const mergeFieldsFromAi = (extracted: any) => {
    if (!extracted) return;
    setFormData(prev => {
      const next: any = { ...prev };
      const fields: (keyof typeof prev)[] = [
        'clienteNome', 'clienteDoc', 'clienteContato', 'clienteSegmento',
        'tipoProjeto', 'dorPrincipal', 'faturamentoMedio', 'ticketMedio',
        'investimentoMensal', 'canalLeads', 'tempoResposta', 'taxaConversao',
        'crmAtual', 'prazoContrato', 'condicaoPagamento', 'onboardingDias',
      ];
      for (const f of fields) {
        const val = extracted[f];
        if (val === null || val === undefined) continue;
        next[f] = val;
      }
      if (Array.isArray(extracted.itens) && extracted.itens.length > 0) {
        const norm = (s: string) => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
        const aiItems = extracted.itens.map((it: any, idx: number) => ({
          id: Date.now() + idx,
          descricao: it.descricao || '',
          escopo: it.escopo || '',
          vlr_un: Number(it.vlr_un) || 0,
          qtd: Number(it.qtd) || 1,
        }));
        const existingItemsEmpty = prev.itens.length === 1 && !prev.itens[0].descricao.trim() && prev.itens[0].vlr_un === 0;
        if (existingItemsEmpty) {
          next.itens = aiItems;
        } else {
          // Dedup por descrição normalizada: se a IA reenviar item igual, substitui o existente.
          const byDesc = new Map<string, any>();
          for (const it of prev.itens) byDesc.set(norm(it.descricao), it);
          for (const ai of aiItems) {
            const key = norm(ai.descricao);
            const existing = byDesc.get(key);
            if (existing) {
              byDesc.set(key, { ...existing, escopo: ai.escopo || existing.escopo, vlr_un: ai.vlr_un || existing.vlr_un, qtd: ai.qtd || existing.qtd });
            } else {
              byDesc.set(key, ai);
            }
          }
          next.itens = Array.from(byDesc.values());
        }
      }
      return next;
    });
  };

  const sendChatMessage = async (userText: string) => {
    if (!userText.trim() || chatLoading) return;
    setChatError(null);
    const userMsg: ChatMsg = { role: 'user', content: userText.trim() };
    const newHistory: ChatMsg[] = [...chatHistory, userMsg];
    setChatHistory(newHistory);
    setChatInput('');
    setChatLoading(true);
    try {
      const currentState = {
        clienteNome: formData.clienteNome,
        clienteDoc: formData.clienteDoc,
        clienteContato: formData.clienteContato,
        clienteSegmento: formData.clienteSegmento,
        tipoProjeto: formData.tipoProjeto,
        dorPrincipal: formData.dorPrincipal,
        faturamentoMedio: formData.faturamentoMedio,
        investimentoMensal: formData.investimentoMensal,
        prazoContrato: formData.prazoContrato,
        condicaoPagamento: formData.condicaoPagamento,
        itens: formData.itens.filter(i => i.descricao || i.vlr_un > 0),
      };
      const res = await crmCall('crm-proposta-chat-ai', {
        history: newHistory,
        current_state: currentState,
        custom_instructions: aiInstructions.trim() || undefined,
      });
      if (res.error) {
        setChatError(res.error);
        return;
      }
      const aiMsg: ChatMsg = { role: 'assistant', content: res.message || '...' };
      setChatHistory(h => [...h, aiMsg]);
      if (res.fields_to_update) mergeFieldsFromAi(res.fields_to_update);
      if (res.done) setChatDone(true);
    } catch (e: any) {
      setChatError(e?.message || 'Erro ao falar com a IA.');
    } finally {
      setChatLoading(false);
      setTimeout(() => {
        chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
      }, 50);
    }
  };

  const startChat = async () => {
    if (chatHistory.length > 0) return;
    setChatLoading(true);
    setChatError(null);
    try {
      const res = await crmCall('crm-proposta-chat-ai', {
        history: [{ role: 'user', content: 'Oi, quero montar uma proposta nova. Pode comecar a entrevista?' }],
        current_state: { clienteNome: formData.clienteNome, tipoProjeto: formData.tipoProjeto },
        custom_instructions: aiInstructions.trim() || undefined,
      });
      if (res.error) { setChatError(res.error); return; }
      setChatHistory([
        { role: 'user', content: 'Oi, quero montar uma proposta nova. Pode comecar a entrevista?' },
        { role: 'assistant', content: res.message || 'Vamos comecar — qual o cliente que vamos atender?' },
      ]);
      if (res.fields_to_update) mergeFieldsFromAi(res.fields_to_update);
      if (res.done) setChatDone(true);
    } catch (e: any) {
      setChatError(e?.message || 'Erro ao iniciar conversa.');
    } finally {
      setChatLoading(false);
    }
  };

  const resetChat = () => {
    setChatHistory([]);
    setChatInput('');
    setChatError(null);
    setChatDone(false);
  };

  const handleSave = async () => {
    const validationErr = validateForm()
    if (validationErr) { setSaveMsg({ type: 'err', text: validationErr }); setTimeout(() => setSaveMsg(null), 4000); return }

    setSaving(true);
    setSaveMsg(null);
    try {
      const dataToSave = {
        cliente_nome: formData.clienteNome.trim(),
        valor_total: total,
        status: 'pendente',
        data_emissao: formData.dataEmissao,
        responsavel: formData.responsavel.trim(),
        conteudo_json: formData
      };

      const res = await crmCall('crm-manage-proposta', { action: 'create', ...dataToSave });

      if (res.error) {
        setSaveMsg({ type: 'err', text: res.error });
      } else {
        setSaveMsg({ type: 'ok', text: 'Proposta salva com sucesso!' });
      }
    } catch {
      setSaveMsg({ type: 'err', text: 'Erro de conexão. A API de propostas pode não estar disponível ainda.' });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 5000);
    }
  };

  const generatePDF = async () => {
    const element = proposalRef.current;
    if (!element) return;

    setExportingPdf(true);
    element.classList.add(s.pdfExporting);

    try {
      await document.fonts?.ready;
      await new Promise(resolve => requestAnimationFrame(resolve));
      // @ts-ignore
      const html2pdf = (await import('html2pdf.js')).default;
      const safeClient = (formData.clienteNome || 'cliente').replace(/[^\w\d-]+/g, '_');
      const safeProposal = formData.numeroProposta.replace(/[^\w\d-]+/g, '_');
      const opt = {
        margin: 0,
        filename: `Proposta_${safeProposal}_${safeClient}.pdf`,
        image: { type: 'png', quality: 1 },
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['tr', `.${s.pdfBoxGrey}`, `.${s.pdfDiagBox}`, `.${s.pdfTotalBox}`],
        },
        html2canvas: {
          scale: Math.min(3, window.devicePixelRatio || 2),
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          windowWidth: element.scrollWidth,
          windowHeight: element.scrollHeight,
          onclone: (doc: Document) => {
            const cloned = doc.getElementById('proposta-template');
            if (!cloned) return;
            cloned.style.width = `${element.offsetWidth}px`;
            cloned.style.minHeight = `${element.scrollHeight}px`;
            cloned.style.boxShadow = 'none';
            cloned.style.transform = 'none';
          },
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
      };
      await html2pdf().from(element).set(opt).save();
    } catch(err) {
      console.error(err);
    } finally {
      element.classList.remove(s.pdfExporting);
      setExportingPdf(false);
    }
  };

  return (
    <div className={s.container}>
      
      {/* SIDEBAR FORMULÁRIO */}
      <aside className={s.sidebar}>
        
        {/* Cabeçalho */}
        <div className={s.sidebarHeader}>
           <div className={s.headerIconBox}>
              <Plus size={20} />
           </div>
           <div style={{ flex: 1 }}>
              <h2 className={s.headerTitle}>Configurador Proposta</h2>
              <p className={s.headerSub}>Terminal Comercial Corporativo</p>
           </div>
        </div>

        {/* Abas Manual / Com IA */}
        <div className={s.tabBar}>
          <button
            type="button"
            onClick={() => setSidebarMode('manual')}
            className={`${s.tabBtn} ${sidebarMode === 'manual' ? s.tabBtnActive : ''}`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => {
              setSidebarMode('chat');
              if (chatHistory.length === 0) startChat();
            }}
            className={`${s.tabBtn} ${sidebarMode === 'chat' ? s.tabBtnActive : ''}`}
          >
            <Sparkles size={12} style={{ marginRight: 4 }} />
            Fazer com IA
          </button>
        </div>
        
        {/* Formulário */}
        {sidebarMode === 'manual' && (
        <div className={s.scrollArea}>
          
          {/* 1. Identificação */}
          <section className={s.section}>
            <div className={s.sectionHeader}>
              <ClipboardList size={14} className={s.sectionHeaderIconWrapper} />
              <h3 className={s.sectionTitle}>Identificação & Matriz Cliente</h3>
            </div>
            
            <div className={s.grid2}>
              <div className={s.inputGroup}>
                <label className={s.label}>Nº Proposta</label>
                <input type="text" value={formData.numeroProposta} onChange={e => setFormData({...formData, numeroProposta: e.target.value})} className={`${s.input} ${s.inputMono}`} />
              </div>
              <div className={s.inputGroup}>
                <CustomDatePicker
                  caption="Data Emissão"
                  value={formData.dataEmissao}
                  onChange={val => setFormData({ ...formData, dataEmissao: val })}
                />
              </div>
              <div className={s.inputGroup}>
                <label className={s.label}>Validade (Dias)</label>
                <input type="number" value={formData.validadeDias} onChange={e => setFormData({...formData, validadeDias: Number(e.target.value)})} className={s.input} />
              </div>
              <div className={s.inputGroup}>
                <label className={s.label}>Responsável</label>
                <input type="text" value={formData.responsavel} onChange={e => setFormData({...formData, responsavel: e.target.value})} className={s.input} placeholder="ID Executivo" />
              </div>
            </div>
            
            <div className={s.inputGroupWide}>
              <div className={s.inputGroup}>
                <label className={s.label}>Razão Social / Cliente</label>
                <input type="text" value={formData.clienteNome} onChange={e => setFormData({...formData, clienteNome: e.target.value})} className={`${s.input} ${s.inputBold}`} placeholder="Nome da Empresa" />
              </div>
              <div className={s.grid2}>
                <div className={s.inputGroup}>
                  <label className={s.label}>Documento CNPJ</label>
                  <input type="text" value={formData.clienteDoc} onChange={e => setFormData({...formData, clienteDoc: e.target.value})} className={`${s.input} ${s.inputMono}`} />
                </div>
                <div className={s.inputGroup}>
                  <label className={s.label}>Segmento</label>
                  <input type="text" value={formData.clienteSegmento} onChange={e => setFormData({...formData, clienteSegmento: e.target.value})} className={s.input} />
                </div>
              </div>
              <div className={s.inputGroup}>
                <label className={s.label}>Contato (WhatsApp/Email)</label>
                <input type="text" value={formData.clienteContato} onChange={e => setFormData({...formData, clienteContato: e.target.value})} className={s.input} />
              </div>
            </div>
          </section>

          {/* 2. Tipo de Projeto */}
          <section className={s.section}>
            <div className={s.sectionHeader}>
              <Briefcase size={14} style={{color: '#52525b'}} />
              <h3 className={s.sectionTitle}>Classificação do Projeto</h3>
            </div>
            <div className={s.grid2}>
              {['Site', 'Software', 'Performance/Vendas', 'Comercial Digital'].map(type => (
                <button
                  key={type}
                  onClick={() => setFormData({...formData, tipoProjeto: type})}
                  className={`${s.toggleBtn} ${formData.tipoProjeto === type ? s.toggleBtnActive : ''}`}
                >
                  {type}
                </button>
              ))}
            </div>

          </section>

          {/* 3. Diagnóstico */}
          <section className={s.section}>
            <div className={s.sectionHeader}>
              <LayoutDashboard size={14} className={s.sectionHeaderIconWrapper} />
              <h3 className={s.sectionTitle}>Diagnóstico Estratégico</h3>
            </div>
            <div className={s.grid2}>
              <div className={`${s.inputGroup} ${s.gridColSpan2}`}>
                <label className={s.label}>Principal Dor do Negócio</label>
                <input type="text" value={formData.dorPrincipal} onChange={e => setFormData({...formData, dorPrincipal: e.target.value})} className={s.input} placeholder="Gargalo principal..." />
              </div>
              <div className={s.inputGroup}>
                <label className={s.label}>Fat. Médio</label>
                <input type="text" value={formData.faturamentoMedio} onChange={e => setFormData({...formData, faturamentoMedio: e.target.value})} className={`${s.input} ${s.inputMono}`} />
              </div>
              <div className={s.inputGroup}>
                <label className={s.label}>Investimento Atual</label>
                <input type="text" value={formData.investimentoMensal} onChange={e => setFormData({...formData, investimentoMensal: e.target.value})} className={`${s.input} ${s.inputMono}`} />
              </div>
              <div className={s.inputGroup}>
                <label className={s.label}>Tempo de Resposta</label>
                <input type="text" value={formData.tempoResposta} onChange={e => setFormData({...formData, tempoResposta: e.target.value})} className={s.input} />
              </div>
              <div className={s.inputGroup}>
                <label className={s.label}>CRM Atual</label>
                <input type="text" value={formData.crmAtual} onChange={e => setFormData({...formData, crmAtual: e.target.value})} className={s.input} />
              </div>
            </div>
          </section>

          {/* 4. Escopo & Valores */}
          <section className={s.section}>
            <div className={s.sectionTitleFlex}>
               <h3 className={s.sectionTitle}>Escopo & precificação</h3>
               <button onClick={handleAddItem} className={s.addBtn}>
                 <Plus size={12} /> Novo Item
               </button>
            </div>
            <div className={s.inputGroupWide}>
              {formData.itens.map((item) => (
                <div key={item.id} className={s.listItem}>
                  <button onClick={() => handleRemoveItem(item.id)} className={s.removeBtn}>
                    <Trash2 size={14} />
                  </button>
                  <div className={s.inputGroup}>
                    <label className={s.itemLabel}>Entrega Proposta</label>
                    <input type="text" value={item.descricao} onChange={e => updateItem(item.id, 'descricao', e.target.value)} className={s.itemInputTrans} placeholder="Ex: Auditoria de Tráfego e Tagging" />
                  </div>
                  <div className={s.inputGroup}>
                    <label className={s.itemLabel}>Escopo / descrição do serviço</label>
                    <textarea
                      value={item.escopo || ''}
                      onChange={e => updateItem(item.id, 'escopo', e.target.value)}
                      className={s.itemTextarea}
                      placeholder="Ex: análise de campanhas, revisão de pixel, eventos, UTMs e recomendações práticas..."
                      rows={3}
                    />
                  </div>
                  <div className={`${s.grid2} ${s.itemBorderT}`}>
                    <div className={s.inputGroup}>
                      <label className={s.itemLabel}>Valor Unitário</label>
                      <input type="number" value={item.vlr_un} onChange={e => updateItem(item.id, 'vlr_un', Number(e.target.value))} className={s.itemInputMono} />
                    </div>
                    <div className={s.inputGroup}>
                      <label className={s.itemLabel}>Quantidade</label>
                      <input type="number" value={item.qtd} onChange={e => updateItem(item.id, 'qtd', Number(e.target.value))} className={s.itemInputMono} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 5. Condições */}
          <section className={`${s.section} ${s.pb20}`}>
            <div className={s.sectionHeader}>
              <CreditCard size={14} style={{color: '#52525b'}} />
              <h3 className={s.sectionTitle}>Condições de Fechamento</h3>
            </div>
            <div className={s.grid2}>
              <div className={s.inputGroup}>
                <label className={s.label}>Prazo Contrato</label>
                <input type="text" value={formData.prazoContrato} onChange={e => setFormData({...formData, prazoContrato: e.target.value})} className={s.input} placeholder="Ex: 12 meses" />
              </div>
              <div className={s.inputGroup}>
                <CustomDatePicker
                  caption="Início Estimado"
                  value={formData.inicioPrevisto}
                  onChange={val => setFormData({ ...formData, inicioPrevisto: val })}
                />
              </div>
              <div className={`${s.inputGroup} ${s.gridColSpan2}`}>
                <label className={s.label}>Política de Negociação / Pagto</label>
                <input type="text" value={formData.condicaoPagamento} onChange={e => setFormData({...formData, condicaoPagamento: e.target.value})} className={s.input} />
              </div>
            </div>
          </section>
        </div>
        )}

        {/* Modo Chat IA */}
        {sidebarMode === 'chat' && (
          <div className={s.chatPanel}>
            {/* Chips com campos preenchidos */}
            <div className={s.chatChipsRow}>
              {formData.clienteNome && <span className={s.chatChip}>✓ {formData.clienteNome}</span>}
              {formData.tipoProjeto && <span className={s.chatChip}>✓ {formData.tipoProjeto}</span>}
              {formData.dorPrincipal && <span className={s.chatChip} title={formData.dorPrincipal}>✓ Dor</span>}
              {formData.itens.some(i => i.descricao && i.vlr_un > 0) && (
                <span className={s.chatChip}>✓ {formData.itens.filter(i => i.descricao && i.vlr_un > 0).length} item(s)</span>
              )}
              {chatDone && <span className={`${s.chatChip} ${s.chatChipDone}`}>● Pronto</span>}
            </div>

            {/* Histórico do chat */}
            <div ref={chatScrollRef} className={s.chatMessages}>
              {chatHistory.length === 0 && !chatLoading && (
                <div className={s.chatEmpty}>
                  <Sparkles size={20} style={{ color: '#be123c', marginBottom: 8 }} />
                  <p>A IA vai te entrevistar para montar a proposta.</p>
                  <button onClick={startChat} className={s.chatStartBtn}>Iniciar entrevista</button>
                </div>
              )}
              {chatHistory.filter((_, i) => i > 0 || chatHistory.length === 1).map((m, idx) => (
                <div key={idx} className={m.role === 'user' ? s.chatMsgUser : s.chatMsgAssistant}>
                  {m.content}
                </div>
              ))}
              {chatLoading && (
                <div className={s.chatMsgAssistant}>
                  <Loader2 size={14} className={s.aiSpin} style={{ display: 'inline-block', marginRight: 6 }} />
                  pensando...
                </div>
              )}
              {chatError && <div className={s.chatErrorBox}>{chatError}</div>}
            </div>

            {/* Input do usuário */}
            <div className={s.chatInputRow}>
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage(chatInput);
                  }
                }}
                disabled={chatLoading || chatHistory.length === 0}
                rows={2}
                className={s.chatInput}
                placeholder={chatHistory.length === 0 ? 'Inicie a entrevista primeiro...' : 'Responda aqui... (Enter para enviar)'}
              />
              <button
                onClick={() => sendChatMessage(chatInput)}
                disabled={chatLoading || !chatInput.trim() || chatHistory.length === 0}
                className={s.chatSendBtn}
                title="Enviar (Enter)"
              >
                <Sparkles size={14} />
              </button>
            </div>

            <div className={s.chatFooterRow}>
              <button onClick={resetChat} className={s.chatResetBtn} disabled={chatLoading}>
                Reiniciar conversa
              </button>
              <button onClick={() => setSidebarMode('manual')} className={s.chatBackBtn}>
                Voltar pro formulário →
              </button>
            </div>
          </div>
        )}

        {/* Painel de Ações Corporativas */}
        <div className={s.actionPanel}>
           {saveMsg && (
             <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: saveMsg.type === 'ok' ? 'rgba(22,163,74,.12)' : 'rgba(220,38,38,.12)', color: saveMsg.type === 'ok' ? '#16a34a' : '#dc2626', border: `1px solid ${saveMsg.type === 'ok' ? 'rgba(22,163,74,.25)' : 'rgba(220,38,38,.25)'}` }}>
               {saveMsg.text}
             </div>
           )}
           <button
             onClick={handleSave}
             disabled={saving}
             className={s.btnPrimary}
           >
             {saving ? 'Gravando no Pipeline...' : <><Save size={16} /> Imputar Proposta no Sistema</>}
           </button>
           
           <button 
             onClick={generatePDF}
             className={s.btnSecondary}
             disabled={exportingPdf}
           >
             <Download size={16} /> {exportingPdf ? 'Gerando PDF...' : 'Exportar Relatório PDF'}
           </button>
        </div>
      </aside>

      {/* VIEW AREA */}
      <main className={s.previewMain}>
        <div className={s.previewScaler}>
            
            {/* O TEMPLATE A4 */}
            <div id="proposta-template" ref={proposalRef} className={s.pdfTemplate}>
               
               <div className={s.pdfWatermarkTop} />
               <div className={s.pdfWatermarkBottom} />

               <div className={s.pdfContent}>
                  {/* Header PDF */}
                  <div className={s.pdfHeader}>
                    <div>
                      <div className={s.pdfBrandLogos}>
                        <img src="/logos/logo-ngp-proposta.png" alt="NGP" className={s.pdfLogo} />
                        <img src="/logos/logo-amplasoft.png" alt="AmplaSoft" className={s.pdfLogoAmpla} />
                      </div>
                      <h1 className={s.pdfTitle}>Proposta<br/>Comercial</h1>
                      <div className={s.pdfDescBox}>
                        <span className={s.pdfLine} />
                        <span className={s.pdfHeadNumber}>{formData.numeroProposta}</span>
                      </div>
                    </div>
                    <div className={s.pdfRightCol}>
                      <div>
                        <p className={s.pdfLabelSmall}>Data de Emissão</p>
                        <p className={s.pdfValSmall}>{new Date(formData.dataEmissao).toLocaleDateString('pt-BR')}</p>
                      </div>
                      <div>
                        <p className={s.pdfLabelSmall}>Responsável NGP</p>
                        <p className={s.pdfValSmallUpper}>{formData.responsavel || '---'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Info Primária */}
                  <div className={s.pdfGrid}>
                    <div>
                      <h4 className={s.pdfH4Red}>Dados da Contratante</h4>
                      <p className={s.pdfClientTitle}>{formData.clienteNome || '---'}</p>
                      <p className={s.pdfClientDoc}>{formData.clienteDoc || '---'}</p>
                      
                      <div className={s.pdfRowInfo}>
                        <p className={s.pdfRowFlex}>
                           <span className={s.pdfLabelWidth}>Foco:</span>
                           <span className={s.pdfValDark}>{formData.clienteSegmento || '---'}</span>
                        </p>
                        <p className={s.pdfRowFlex}>
                           <span className={s.pdfLabelWidth}>Contato:</span>
                           <span className={s.pdfValDark}>{formData.clienteContato || '---'}</span>
                        </p>
                      </div>
                    </div>
                    <div className={s.pdfBoxGrey}>
                      <h4 className={s.pdfH4Grey}>Contexto & Projeto</h4>
                      <div className={s.pdfGridNested}>
                        <div style={{gridColumn: 'span 2'}}>
                          <p className={s.pdfLabelTiny}>Tipo de Entrega</p>
                          <p className={s.pdfValRed}>{formData.tipoProjeto}</p>
                        </div>
                        <div>
                          <p className={s.pdfLabelTiny}>CRM Alvo</p>
                          <p className={s.pdfValNorm}>{formData.crmAtual || '---'}</p>
                        </div>
                        <div>
                          <p className={s.pdfLabelTiny}>Conversão Alvo</p>
                          <p className={s.pdfValNorm}>{formData.taxaConversao || 'Escalável'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Diagnóstico */}
                  <div>
                     <h4 className={s.pdfH4Red}>Considerações do Diagnóstico</h4>
                     <div className={s.pdfDiagBox}>
                        <BarChart4 style={{position:'absolute', right:'-20px', bottom:'-20px', width:'192px', height:'192px', color:'rgba(255,255,255,0.03)'}} />
                        <div className={s.pdfDiagGrid}>
                           <div className={s.pdfDiagCol}>
                              <p className={s.pdfDiagLabel}>Dor Identificada</p>
                              <p className={s.pdfDiagVal}>{formData.dorPrincipal || '---'}</p>
                           </div>
                           <div className={s.pdfDiagColBorder}>
                              <p className={s.pdfDiagLabel}>Investment Cap</p>
                              <p className={s.pdfDiagVal}>{formData.investimentoMensal || '---'}</p>
                           </div>
                           <div className={s.pdfDiagColBorder}>
                              <p className={s.pdfDiagLabel}>Fat. Referência</p>
                              <p className={s.pdfDiagVal}>{formData.faturamentoMedio || '---'}</p>
                           </div>
                        </div>
                     </div>
                  </div>

                  {/* Escopo */}
                  <div className={s.pdfTableWrap}>
                    <h4 className={s.pdfH4Red}>Escopo Detalhado & Alocação</h4>
                    <table className={s.pdfTable}>
                      <thead>
                        <tr>
                          <th style={{textAlign: 'left'}} className={s.pdfTh}>Atividade / Entrega</th>
                          <th style={{textAlign: 'center'}} className={s.pdfTh}>Qtd</th>
                          <th style={{textAlign: 'right'}} className={s.pdfTh}>Valor Uni.</th>
                          <th style={{textAlign: 'right'}} className={s.pdfTh}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {formData.itens.map(item => (
                          <tr key={item.id}>
                            <td className={`${s.pdfTd} ${s.pdfTdDesc}`}>
                              <div>{item.descricao || '---'}</div>
                              {item.escopo && <p className={s.pdfTdScope}>{item.escopo}</p>}
                            </td>
                            <td className={`${s.pdfTd} ${s.pdfTdNum}`} style={{textAlign:'center'}}>{item.qtd}</td>
                            <td className={`${s.pdfTd} ${s.pdfTdNum}`} style={{textAlign:'right'}}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.vlr_un)}</td>
                            <td className={`${s.pdfTd} ${s.pdfTdTotal}`} style={{textAlign:'right'}}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.vlr_un * item.qtd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    
                    <div className={s.pdfTotalWrap}>
                      <div className={s.pdfTotalBox}>
                        <p className={s.pdfTotalLabel}>Total do Projeto</p>
                        <p className={s.pdfTotalNum}>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Termos Finais */}
                  <div className={s.pdfFooterGrid}>
                     <div className={s.pdfFooterCol}>
                        <div>
                           <h5 className={s.pdfMiniH5}>Acordo de Pagamento</h5>
                           <p className={s.pdfTextSmall}>{formData.condicaoPagamento}</p>
                        </div>
                        <div>
                           <h5 className={s.pdfMiniH5}>Cronograma Operacional</h5>
                           <p className={s.pdfTextSmall}>Início Estimado: {formData.inicioPrevisto || '--/--/----'}</p>
                           <p className={s.pdfTextSmall}>Setup / Onboarding: {formData.onboardingDias} dias úteis</p>
                        </div>
                     </div>
                     <div className={s.pdfTermsRight}>
                        <p className={s.pdfTermNote1}>Reserva de Validade: {formData.validadeDias} dias corridos.</p>
                        <p className={s.pdfTermNote2}>Este documento integra o processo oficial de diagnóstico NGP. Todos os valores são líquidos.</p>
                     </div>
                  </div>
               </div>
            </div>

        </div>
      </main>

      {/* AI MODAL */}
      {aiOpen && (
        <div className={s.aiOverlay} onClick={() => !aiLoading && setAiOpen(false)}>
          <div className={s.aiModal} onClick={e => e.stopPropagation()}>
            <div className={s.aiModalHeader}>
              <div className={s.aiModalTitleBlock}>
                <Sparkles size={18} style={{ color: '#be123c' }} />
                <div>
                  <h3 className={s.aiModalTitle}>Preencher Proposta com IA</h3>
                  <p className={s.aiModalSub}>Cole o briefing, transcript da reunião, ou descreva o cliente em texto livre.</p>
                </div>
              </div>
              <button onClick={() => setAiOpen(false)} disabled={aiLoading} className={s.aiCloseBtn}>
                <X size={16} />
              </button>
            </div>

            <div className={s.aiModalBody}>
              <textarea
                value={aiBriefing}
                onChange={e => setAiBriefing(e.target.value)}
                disabled={aiLoading}
                rows={8}
                className={s.aiTextarea}
                placeholder={`Exemplo:\n\nCliente Padaria Pão Quente, CNPJ 12.345.678/0001-99, segmento alimentício. Falei com o João pelo WhatsApp 11999998888. Dor: pouco lead, atendimento confuso. Faturam uns 80k/mês, hoje investem 2k em ads. Vamos vender Performance — fechei em 8k/mês por 12 meses + setup de R$ 2.500. Pagamento mensal recorrente.`}
              />

              <div className={s.aiInstructionsBlock}>
                <button
                  type="button"
                  onClick={() => setAiShowInstructions(v => !v)}
                  className={s.aiInstructionsToggle}
                >
                  <span>{aiShowInstructions ? '▾' : '▸'} Instruções padrão para a IA</span>
                  <span className={s.aiInstructionsBadge}>
                    {aiInstructions === DEFAULT_AI_INSTRUCTIONS ? 'padrão' : 'personalizado'}
                  </span>
                </button>
                {aiShowInstructions && (
                  <>
                    <textarea
                      value={aiInstructions}
                      onChange={e => persistInstructions(e.target.value)}
                      disabled={aiLoading}
                      rows={6}
                      className={s.aiInstructionsTextarea}
                      placeholder="Ex: Sempre incluir relatório semanal e reunião mensal. Tom técnico para SaaS. Garantia de 30 dias..."
                    />
                    <div className={s.aiInstructionsHint}>
                      Salvo automaticamente. Reaproveitado em todas as próximas propostas neste navegador.
                      <button
                        type="button"
                        onClick={restoreDefaultInstructions}
                        disabled={aiLoading}
                        className={s.aiInstructionsRestore}
                      >
                        Restaurar padrão
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className={s.aiModeRow}>
                <span className={s.aiModeLabel}>Comportamento:</span>
                <label className={s.aiRadio}>
                  <input
                    type="radio"
                    checked={aiMode === 'merge'}
                    onChange={() => setAiMode('merge')}
                    disabled={aiLoading}
                  />
                  Só preencher campos vazios
                </label>
                <label className={s.aiRadio}>
                  <input
                    type="radio"
                    checked={aiMode === 'overwrite'}
                    onChange={() => setAiMode('overwrite')}
                    disabled={aiLoading}
                  />
                  Sobrescrever tudo
                </label>
              </div>

              {aiError && <div className={s.aiErrorBox}>{aiError}</div>}
            </div>

            <div className={s.aiModalFooter}>
              <button onClick={() => setAiOpen(false)} disabled={aiLoading} className={s.aiBtnGhost}>
                Cancelar
              </button>
              <button onClick={handleAiFill} disabled={aiLoading} className={s.aiBtnPrimary}>
                {aiLoading ? <><Loader2 size={14} className={s.aiSpin} /> Processando...</> : <><Sparkles size={14} /> Preencher</>}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
