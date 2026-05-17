/* eslint-disable */
// ──────────────────────────────────────────────────────────────────────────────
// NGP_IA · Módulo de IA do relatório (extraído de relatorio-static.html)
// ──────────────────────────────────────────────────────────────────────────────
//
// Por que existe: o HTML original cresceu pra 4400+ linhas. Esse módulo isola
// toda a comunicação com a edge function `relatorio-ia` (e helpers correlatos)
// num arquivo único, mantendo coesão.
//
// Como funciona:
// - Carregado via <script src="/relatorio-ia.js"></script> ANTES do bloco
//   principal do HTML.
// - Expõe window.NGP_IA = { init({...deps}), callIA, gerarResumoIA, ... }.
// - O HTML chama NGP_IA.init({...}) passando os globals que o módulo precisa
//   (D, _sess, SURL, ANON, saveData, render, snapshotMetricasAtuais, etc).
//   Sem essa ponte, o módulo não tem como ver as variáveis do <script> inline
//   (let/const top-level não vazam pra window).
// - As funções globais que o HTML usa via onclick (gerarResumoIA(),
//   gerarComparativoIA(ci), gerarPorqueGanhaIA(ci)) também são expostas
//   diretamente em window pra manter compat sem reescrever os handlers inline.
//
// O que NÃO está aqui:
// - Lógica de autoimport (renderização, fetch Meta/Google) — fica no HTML.
//   O HTML pede pra IA rodar via NGP_IA.runOndas(...) quando chegar a hora.
//
// Decisão consciente: NÃO virar ESM. O HTML não é module e converter exige
// repensar todos os handlers inline. Pra extração cirúrgica, script clássico
// + namespace é o caminho mais seguro.

(function () {
  'use strict';

  // Container do estado/deps injetadas. ATENÇÃO: D é reatribuído no HTML
  // (loadData/loadFromCloud fazem `D = ...`). Por isso o init recebe um GETTER
  // `getD()` em vez do D direto — assim o módulo sempre lê a referência atual.
  // O HTML pode passar `D: D` (snapshot inicial) por compat: nesse caso o
  // módulo captura uma vez no init e perde reatribuições. Não usar.
  const _deps = {
    getD: null,     // () => objeto D atual (reatribuído por loadData/loadFromCloud)
    sess: null,     // sessão (_sess) — string ou null
    SURL: null,
    ANON: null,
    getCloudId: null,
    saveData: null,
    render: null,
    snapshotMetricasAtuais: null,
    snapshotMetricasAnterior: null,
  };

  function _requireInit() {
    if (!_deps.getD) throw new Error('NGP_IA não inicializado. Chame NGP_IA.init({getD, sess, SURL, ANON, ...}) antes.');
  }
  function _D() { return _deps.getD(); }

  // ── callIA ────────────────────────────────────────────────────────────────
  // Wrapper de fetch da edge function `relatorio-ia` com retry leve em erros
  // transientes (429 sem rate_limited, 502/503/504, network). Erros definitivos
  // (401/403/400, 429 rate_limited) NÃO retentam.
  //
  // opts.silent=true: erros viram console.warn em vez de alert. Usar no autoimport.
  const _CALL_IA_TRANSIENT = new Set([502, 503, 504]);
  async function callIA(mode, payload, opts) {
    _requireInit();
    const silent = !!(opts && opts.silent);
    const sess = _deps.sess;
    if (!sess) {
      if (!silent) alert('Faça login para usar IA.');
      else console.warn('[callIA] sem sessão (silent)');
      return null;
    }
    const _doFetch = async () => {
      const res = await fetch(_deps.SURL + '/functions/v1/relatorio-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': _deps.ANON, 'Authorization': 'Bearer ' + sess },
        body: JSON.stringify({ session_token: sess, mode, ...payload }),
      });
      const j = await res.json().catch(() => ({}));
      return { res, j };
    };
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { res, j } = await _doFetch();
        if (res.ok && !j.error) return j.result;
        const isRateLimited = !!j.rate_limited;
        const transient = !isRateLimited && (_CALL_IA_TRANSIENT.has(res.status) || res.status === 429);
        if (transient && attempt === 1) {
          const wait = 800 + Math.floor(Math.random() * 400);
          console.warn(`[callIA ${mode}] transiente HTTP ${res.status}, retry em ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        const msg = 'Erro da IA: ' + (j.error || res.status);
        if (silent) console.warn('[callIA ' + mode + ']', msg);
        else alert(msg);
        return null;
      } catch (e) {
        lastErr = e;
        if (attempt === 1) {
          const wait = 800 + Math.floor(Math.random() * 400);
          console.warn(`[callIA ${mode}] network error, retry em ${wait}ms:`, e && e.message);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        const msg = 'Falha na IA: ' + (e && e.message ? e.message : 'tente novamente.');
        if (silent) console.warn('[callIA ' + mode + ']', msg);
        else alert(msg);
        return null;
      }
    }
    if (lastErr && !silent) alert('Falha na IA após retentativa: ' + (lastErr.message || 'tente novamente.'));
    return null;
  }

  // ── setIAWritingLock ──────────────────────────────────────────────────────
  // Overlay roxo sobre o textarea do resumo durante chamadas IA. Evita race
  // condition do gestor digitar enquanto IA escreve.
  //
  // SAFETY: como o overlay bloqueia a textarea, uma chamada órfã a setLock(true)
  // sem o finally correspondente trava a UI. Defesas:
  // 1. Timeout automático de 90s — se IA travou, libera sozinho.
  // 2. _lockLabel guardado pra reposicionar sem ligar lock que não estava ligado.
  // 3. Click no overlay libera manualmente (escape hatch).
  let _iaLockActive = false;
  let _lockLabel = '';
  let _lockSafetyTimer = null;
  const _LOCK_SAFETY_MS = 90 * 1000;

  function setIAWritingLock(on, label) {
    _iaLockActive = !!on;
    if (on && typeof label === 'string') _lockLabel = label;
    const old = document.getElementById('ia-write-overlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (_lockSafetyTimer) { clearTimeout(_lockSafetyTimer); _lockSafetyTimer = null; }
    if (!on) { _lockLabel = ''; return; }
    const ta = document.getElementById('resumo-textarea');
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const ov = document.createElement('div');
    ov.id = 'ia-write-overlay';
    ov.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:rgba(124,58,237,0.06);backdrop-filter:blur(1px);-webkit-backdrop-filter:blur(1px);border:1.5px dashed #9333EA;border-radius:8px;z-index:400;pointer-events:auto;display:flex;align-items:center;justify-content:center;color:#6D28D9;font-weight:700;font-size:12px;font-family:Sora,sans-serif;cursor:pointer;text-align:center;padding:8px`;
    ov.title = 'Clique para liberar a edição';
    ov.textContent = _lockLabel || '✨ IA escrevendo o resumo… você poderá editar quando terminar';
    // Escape hatch: clicar no overlay libera. Útil quando IA trava e usuário
    // quer editar manualmente.
    ov.addEventListener('click', () => {
      console.warn('[IA lock] liberado manualmente pelo usuário');
      setIAWritingLock(false);
    });
    document.body.appendChild(ov);
    // Safety timeout
    _lockSafetyTimer = setTimeout(() => {
      console.warn('[IA lock] safety timeout de 90s — liberando overlay travado');
      setIAWritingLock(false);
    }, _LOCK_SAFETY_MS);
  }
  function isLockActive() { return _iaLockActive; }
  // Reposiciona overlay sem mudar o estado do lock. Chamada do render():
  // se lock está ativo, atualiza posição (textarea pode ter mudado de lugar
  // após re-render). Se inativo, NÃO faz nada — não religa.
  function repositionLock(){
    if(!_iaLockActive) return;
    setIAWritingLock(true, _lockLabel);
  }
  window.addEventListener('resize', repositionLock);

  // ── transcreverVideoCriativo ──────────────────────────────────────────────
  // Pede a edge function pra transcrever o áudio do vídeo do criativo Meta.
  // Falhas (413 vídeo grande, 404 deletado) viram log — não bloqueiam IA.
  async function transcreverVideoCriativo(videoId) {
    _requireInit();
    if (!videoId || !_deps.sess) return '';
    try {
      const res = await fetch(_deps.SURL + '/functions/v1/relatorio-transcrever-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': _deps.ANON, 'Authorization': 'Bearer ' + _deps.sess },
        body: JSON.stringify({ session_token: _deps.sess, video_id: videoId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn('[transcrever] não disponível:', j.error || res.status);
        return '';
      }
      return (j && j.texto) ? String(j.texto) : '';
    } catch (e) {
      console.warn('[transcrever] falhou, segue sem transcrição:', e);
      return '';
    }
  }

  // ── gerarResumoIA (botão manual) ──────────────────────────────────────────
  // Chamado pelo onclick do botão "✨ Gerar com IA" na seção Resumo.
  async function gerarResumoIA() {
    _requireInit();
    const D = _D();
    const btn = document.getElementById('btn-ia-resumo');
    const ta = document.getElementById('resumo-textarea');
    if (!ta) return;
    if (D.resumo && D.resumo.trim()) {
      if (!confirm('Sobrescrever o resumo atual com a versão gerada pela IA?')) return;
    }
    const oldHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.innerHTML = '⟳ Gerando…'; btn.disabled = true; }
    setIAWritingLock(true, '✨ Gerando resumo… aguarde');
    let result = null;
    try {
      result = await callIA('resumo', {
        cliente: D.cliente || '',
        periodo: D.periodo || '',
        metricas: _deps.snapshotMetricasAtuais(),
        metricas_anterior: _deps.snapshotMetricasAnterior(),
      });
    } finally {
      if (btn) { btn.innerHTML = oldHTML; btn.disabled = false; }
      setIAWritingLock(false);
    }
    if (result && result.texto) {
      D.aiResumo = result.texto;
      D.resumo = result.texto;
      ta.value = result.texto;
      _deps.saveData();
    }
  }

  // ── gerarPorqueGanhaIA (botão por criativo) ───────────────────────────────
  async function gerarPorqueGanhaIA(ci) {
    _requireInit();
    const D = _D();
    const c = (D.criativos || [])[ci];
    if (!c) return;
    if (c.porqueGanha && c.porqueGanha.trim()) {
      if (!confirm('Sobrescrever a justificativa atual com a versão da IA?')) return;
    }
    const ta = document.getElementById('porque-ganha-' + ci);
    const card = ta ? ta.closest('.criativo-card') : null;
    const btn = card ? card.querySelector('button[onclick^="gerarPorqueGanhaIA"]') : null;
    const oldHTML = btn ? btn.innerHTML : '';
    const setLoading = (txt) => { if (btn) { btn.innerHTML = txt; btn.disabled = true; } };
    const clearLoading = () => { if (btn) { btn.innerHTML = oldHTML; btn.disabled = false; } };

    let transcricao = '';
    if (c.videoId) {
      setLoading('⟳ Transcrevendo áudio…');
      transcricao = await transcreverVideoCriativo(c.videoId);
    }
    setLoading('⟳ Analisando…');

    const criativosArr = D.criativos || [];
    const outros = criativosArr
      .map((x, idx) => ({ x, idx }))
      .filter((o) => o.idx !== ci && o.x && (o.x.img || o.x.nome))
      .map((o) => ({
        posicao: o.idx + 1,
        nome: o.x.nome || '',
        metricas: (o.x.chips || []).reduce((acc, ch) => { if (ch.label) acc[ch.label] = ch.val || ''; return acc; }, {}),
        tituloAd: o.x.tituloAd || '',
        legenda: o.x.legenda || '',
      }));
    const imgsComp = criativosArr
      .map((x, idx) => ({ x, idx }))
      .filter((o) => o.idx !== ci && o.x && o.x.img && /^https?:\/\//i.test(o.x.img))
      .map((o) => o.x.img)
      .slice(0, 3);
    const imgPrincipal = (c.img && /^https?:\/\//i.test(c.img)) ? c.img : '';

    const result = await callIA('criativo', {
      cliente: D.cliente || '',
      periodo: D.periodo || '',
      posicao: ci + 1,
      total_criativos: criativosArr.length,
      criativo: {
        nome: c.nome || '',
        metricas: (c.chips || []).reduce((acc, ch) => { if (ch.label) acc[ch.label] = ch.val || ''; return acc; }, {}),
        tituloAd: c.tituloAd || '',
        legenda: c.legenda || '',
      },
      criativos_comparativos: outros,
      imagem_principal: imgPrincipal,
      imagens_comparativas: imgsComp,
      transcricao_principal: transcricao,
    });
    clearLoading();
    if (result && result.porqueGanha) {
      D.criativos[ci].porqueGanha = result.porqueGanha;
      if (ta) ta.value = result.porqueGanha;
      _deps.saveData();
    }
  }

  // ── gerarComparativoIA (botão manual) ─────────────────────────────────────
  async function gerarComparativoIA() {
    _requireInit();
    const D = _D();
    const txt = (D.resumo || '').trim();
    const temBullets = /[✓⚠—]\s/.test(txt);
    if (temBullets) {
      if (!confirm('Já existe uma análise comparativa no resumo. Adicionar mais uma versão da IA?')) return;
    } else if (txt) {
      if (!confirm('O resumo já tem texto. Anexar a análise comparativa abaixo?')) return;
    }
    if (!Object.keys(_deps.snapshotMetricasAnterior()).length) {
      alert('Não há dados do período anterior nas métricas. Preencha a coluna "Semana anterior" primeiro.');
      return;
    }
    setIAWritingLock(true, '✨ Gerando análise comparativa… aguarde');
    let result = null;
    try {
      result = await callIA('comparativo', {
        cliente: D.cliente || '',
        periodo: D.periodo || '',
        metricas: _deps.snapshotMetricasAtuais(),
        metricas_anterior: _deps.snapshotMetricasAnterior(),
      });
    } finally {
      setIAWritingLock(false);
    }
    if (!result) return;
    const partes = [];
    if (result.melhorou && result.melhorou.length) partes.push(result.melhorou.map((b) => '✓ ' + b).join(' | '));
    if (result.piorou && result.piorou.length)     partes.push(result.piorou.map((b) => '⚠ ' + b).join(' | '));
    if (result.neutro && result.neutro.length)     partes.push(result.neutro.map((b) => '— ' + b).join(' | '));
    const compTxt = partes.join('\n');
    D.aiComparativo = compTxt;
    const novoTexto = (D.resumo ? D.resumo + '\n\n' : '') + compTxt;
    D.resumo = novoTexto;
    const ta = document.getElementById('resumo-textarea');
    if (ta) ta.value = novoTexto;
    _deps.saveData();
  }

  // ── init ──────────────────────────────────────────────────────────────────
  // O HTML chama NGP_IA.init({...}) DEPOIS de declarar D, _sess, etc.
  // CRÍTICO: `getD` é uma função `() => D`, não o D direto, porque D é
  // reatribuído em loadData/loadFromCloud. Sem o getter, o módulo IA fica
  // segurando referência ao D vazio inicial.
  function init(deps) {
    if (!deps) throw new Error('NGP_IA.init: deps obrigatório');
    const required = ['getD', 'sess', 'SURL', 'ANON', 'saveData', 'render', 'snapshotMetricasAtuais', 'snapshotMetricasAnterior'];
    for (const k of required) {
      if (!(k in deps)) throw new Error('NGP_IA.init: falta ' + k);
    }
    _deps.getD = deps.getD;
    _deps.sess = deps.sess;
    _deps.SURL = deps.SURL;
    _deps.ANON = deps.ANON;
    _deps.saveData = deps.saveData;
    _deps.render = deps.render;
    _deps.snapshotMetricasAtuais = deps.snapshotMetricasAtuais;
    _deps.snapshotMetricasAnterior = deps.snapshotMetricasAnterior;
    _deps.getCloudId = deps.getCloudId || null;
    console.log('[NGP_IA] inicializado');
  }

  // Expõe namespace e atalhos globais (handlers inline do HTML).
  window.NGP_IA = {
    init,
    callIA,
    setIAWritingLock,
    repositionLock,
    isLockActive,
    transcreverVideoCriativo,
    gerarResumoIA,
    gerarPorqueGanhaIA,
    gerarComparativoIA,
  };
  // Atalhos pros handlers inline existentes no HTML (onclick="gerarResumoIA()")
  window.gerarResumoIA = gerarResumoIA;
  window.gerarPorqueGanhaIA = gerarPorqueGanhaIA;
  window.gerarComparativoIA = gerarComparativoIA;
  // E pros chamadores do autoimport
  window.callIA = callIA;
  window.setIAWritingLock = setIAWritingLock;
  window.transcreverVideoCriativo = transcreverVideoCriativo;
})();
