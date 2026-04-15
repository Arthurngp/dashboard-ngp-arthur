'use client'

import React, { useState, useRef } from 'react';
import { Target, FileText, Download, Calculator, Package, User, CreditCard, ChevronRight, Briefcase, BarChart4, ClipboardList, Plus, Trash2, LayoutDashboard, Save } from 'lucide-react';
import { crmCall } from '@/lib/crm-api';
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

  const validateForm = (): string | null => {
    if (!formData.clienteNome.trim()) return 'Preencha o nome do cliente.'
    if (!formData.responsavel.trim()) return 'Preencha o responsável.'
    const invalidItems = formData.itens.filter(i => !i.descricao.trim() || i.vlr_un <= 0 || i.qtd <= 0)
    if (invalidItems.length > 0) return 'Todos os itens precisam de descrição, valor e quantidade válidos.'
    if (total <= 0) return 'O valor total deve ser maior que zero.'
    return null
  }

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
           <div>
              <h2 className={s.headerTitle}>Configurador Proposta</h2>
              <p className={s.headerSub}>Terminal Comercial Corporativo</p>
           </div>
        </div>
        
        {/* Formulário */}
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
                <label className={s.label}>Data Emissão</label>
                <div className="ngp-date-field ngp-date-field--full">
                  <input type="date" value={formData.dataEmissao} onChange={e => setFormData({...formData, dataEmissao: e.target.value})} className="ngp-date-input" />
                  <svg className="ngp-date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="17" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
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
                <label className={s.label}>Início Estimado</label>
                <input type="text" value={formData.inicioPrevisto} onChange={e => setFormData({...formData, inicioPrevisto: e.target.value})} className={s.input} />
              </div>
              <div className={`${s.inputGroup} ${s.gridColSpan2}`}>
                <label className={s.label}>Política de Negociação / Pagto</label>
                <input type="text" value={formData.condicaoPagamento} onChange={e => setFormData({...formData, condicaoPagamento: e.target.value})} className={s.input} />
              </div>
            </div>
          </section>
        </div>
        
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
                      <img src="/logo-ngp-proposta.png" alt="NGP Logo" className={s.pdfLogo} />
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

    </div>
  );
}
