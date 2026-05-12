"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRACT_FIXED_RULES = exports.CONTRACT_DEFAULT_TEMPLATE = exports.EMPTY_CONTRACT_DRAFT = exports.CONTRACT_PLACEHOLDERS = exports.CONTRACT_FIELD_GROUPS = exports.CONTRACT_FIELD_LABELS = void 0;
exports.normalizeContractField = normalizeContractField;
exports.mergeContractDraft = mergeContractDraft;
exports.hydrateContractDraft = hydrateContractDraft;
exports.getMissingContractFields = getMissingContractFields;
exports.getContractCompletion = getContractCompletion;
exports.applyContractTemplate = applyContractTemplate;
exports.getRemainingPlaceholders = getRemainingPlaceholders;
exports.buildContractConfirmationSummary = buildContractConfirmationSummary;
exports.getChangedContractFields = getChangedContractFields;
exports.buildContractChangeConfirmation = buildContractChangeConfirmation;
exports.buildContractFileName = buildContractFileName;
exports.getContractParagraphs = getContractParagraphs;
exports.isPositiveConfirmation = isPositiveConfirmation;
exports.getMissingGroups = getMissingGroups;
exports.buildContractMissingPrompt = buildContractMissingPrompt;
exports.CONTRACT_FIELD_LABELS = {
    nomeCliente: 'Razao social',
    cnpjCliente: 'CNPJ',
    enderecoCliente: 'Endereco da empresa',
    telefoneCliente: 'Telefone da empresa',
    nomeResponsavel: 'Nome do responsavel',
    nacionalidade: 'Nacionalidade',
    estadoCivil: 'Estado civil',
    profissao: 'Profissao',
    rgResponsavel: 'RG',
    cpfResponsavel: 'CPF',
    enderecoResponsavel: 'Endereco do responsavel',
    plataformas: 'Plataformas contratadas',
    valorMensal: 'Valor mensal',
    valorMensalExtenso: 'Valor mensal por extenso',
    valorMinimoTrafego: 'Investimento minimo em trafego',
    valorParcela: 'Valor da parcela',
    diaEmissaoNfSubsequente: 'Dia de emissao da NF',
    diaVencimento: 'Dia de vencimento',
    vencimentoParcela1: 'Vencimento parcela 1',
    vencimentoParcela2: 'Vencimento parcela 2',
    vencimentoParcela3: 'Vencimento parcela 3',
    dataContrato: 'Data do contrato',
    cidadeContrato: 'Cidade do contrato',
};
exports.CONTRACT_FIELD_GROUPS = [
    {
        id: 'empresa',
        title: 'Empresa contratante',
        fields: ['nomeCliente', 'cnpjCliente', 'enderecoCliente', 'telefoneCliente'],
    },
    {
        id: 'responsavel',
        title: 'Responsavel legal',
        fields: [
            'nomeResponsavel',
            'nacionalidade',
            'estadoCivil',
            'profissao',
            'rgResponsavel',
            'cpfResponsavel',
            'enderecoResponsavel',
        ],
    },
    {
        id: 'servico',
        title: 'Escopo e financeiro',
        fields: ['plataformas', 'valorMensal', 'valorMensalExtenso', 'valorMinimoTrafego', 'valorParcela'],
    },
    {
        id: 'pagamento',
        title: 'Pagamento',
        fields: [
            'diaEmissaoNfSubsequente',
            'diaVencimento',
            'vencimentoParcela1',
            'vencimentoParcela2',
            'vencimentoParcela3',
        ],
    },
    {
        id: 'geral',
        title: 'Assinatura',
        fields: ['dataContrato', 'cidadeContrato'],
    },
];
exports.CONTRACT_PLACEHOLDERS = {
    nomeCliente: '{NOME_CLIENTE}',
    cnpjCliente: '{CNPJ_CLIENTE}',
    enderecoCliente: '{ENDERECO_CLIENTE}',
    telefoneCliente: '{TELEFONE_CLIENTE}',
    nomeResponsavel: '{NOME_RESPONSAVEL}',
    nacionalidade: '{NACIONALIDADE}',
    estadoCivil: '{ESTADO_CIVIL}',
    profissao: '{PROFISSAO}',
    rgResponsavel: '{RG_RESPONSAVEL}',
    cpfResponsavel: '{CPF_RESPONSAVEL}',
    enderecoResponsavel: '{ENDERECO_RESPONSAVEL}',
    plataformas: '{PLATAFORMAS}',
    valorMensal: '{VALOR_MENSAL}',
    valorMensalExtenso: '{VALOR_MENSAL_EXTENSO}',
    valorMinimoTrafego: '{VALOR_MINIMO_TRAFEGO}',
    valorParcela: '{VALOR_PARCELA}',
    diaEmissaoNfSubsequente: '{DIA_EMISSAO_NF_SUBSEQUENTE}',
    diaVencimento: '{DIA_VENCIMENTO}',
    vencimentoParcela1: '{VENCIMENTO_PARCELA_1}',
    vencimentoParcela2: '{VENCIMENTO_PARCELA_2}',
    vencimentoParcela3: '{VENCIMENTO_PARCELA_3}',
    dataContrato: '{DATA_CONTRATO}',
    cidadeContrato: '{CIDADE_CONTRATO}',
};
exports.EMPTY_CONTRACT_DRAFT = {
    nomeCliente: '',
    cnpjCliente: '',
    enderecoCliente: '',
    telefoneCliente: '',
    nomeResponsavel: '',
    nacionalidade: '',
    estadoCivil: '',
    profissao: '',
    rgResponsavel: '',
    cpfResponsavel: '',
    enderecoResponsavel: '',
    plataformas: '',
    valorMensal: '',
    valorMensalExtenso: '',
    valorMinimoTrafego: '',
    valorParcela: '',
    diaEmissaoNfSubsequente: '',
    diaVencimento: '',
    vencimentoParcela1: '',
    vencimentoParcela2: '',
    vencimentoParcela3: '',
    dataContrato: '',
    cidadeContrato: '',
};
exports.CONTRACT_DEFAULT_TEMPLATE = `CONTRATO DE GESTAO DE TRAFEGO E PERFORMANCE

[Cole aqui o contrato oficial da NGP com os placeholders abaixo.]

Campos suportados:
{NOME_CLIENTE}
{CNPJ_CLIENTE}
{ENDERECO_CLIENTE}
{TELEFONE_CLIENTE}
{NOME_RESPONSAVEL}
{NACIONALIDADE}
{ESTADO_CIVIL}
{PROFISSAO}
{RG_RESPONSAVEL}
{CPF_RESPONSAVEL}
{ENDERECO_RESPONSAVEL}
{PLATAFORMAS}
{VALOR_MENSAL}
{VALOR_MENSAL_EXTENSO}
{VALOR_MINIMO_TRAFEGO}
{VALOR_PARCELA}
{DIA_EMISSAO_NF_SUBSEQUENTE}
{DIA_VENCIMENTO}
{VENCIMENTO_PARCELA_1}
{VENCIMENTO_PARCELA_2}
{VENCIMENTO_PARCELA_3}
{DATA_CONTRATO}
{CIDADE_CONTRATO}`;
exports.CONTRACT_FIXED_RULES = [
    'Contratada: Nova Gestao de Performance, CNPJ 59.582.810/0001-46',
    'Responsavel NGP: Arthur Eduardo Mendes de Oliveira, CPF 114.073.584-56',
    'PIX: CNPJ 59.582.810/0001-46, Nubank',
    'Banco alternativo: Inter 077, Ag 0001, C/C 44416628-9',
    'Foro: Caruaru-PE',
    'Prazo minimo: 90 dias / 3 meses',
    'Aviso previo: 15 dias corridos',
    'Prazo de regularizacao: 5 dias uteis',
    'Reuniao: quinzenal',
    'Relatorios: semanais toda sexta + analise mensal ate o 5o dia util',
    '1a NF: emitida no ato da assinatura',
    'Vigencia: trimestral',
];
const MONEY_KEYS = ['valorMensal', 'valorMinimoTrafego', 'valorParcela'];
const DATE_KEYS = ['vencimentoParcela1', 'vencimentoParcela2', 'vencimentoParcela3'];
const DAY_KEYS = ['diaEmissaoNfSubsequente', 'diaVencimento'];
const AUTO_DERIVED_FIELDS = ['valorMensalExtenso', 'valorParcela'];
function digitsOnly(value) {
    return value.replace(/\D+/g, '');
}
function normalizeIntentText(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function toTitleCase(value) {
    return value
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
        .join(' ');
}
function formatCpf(value) {
    const digits = digitsOnly(value).slice(0, 11);
    if (digits.length !== 11)
        return value.trim();
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}
function formatCnpj(value) {
    const digits = digitsOnly(value).slice(0, 14);
    if (digits.length !== 14)
        return value.trim();
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}
function formatPhone(value) {
    const digits = digitsOnly(value).slice(0, 11);
    if (digits.length === 11)
        return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    if (digits.length === 10)
        return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return value.trim();
}
function parseMoney(value) {
    const normalized = value.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}
function formatMoney(value, withCurrencySymbol = false) {
    const numeric = parseMoney(value);
    if (numeric == null)
        return value.trim();
    const formatted = numeric.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return withCurrencySymbol ? `R$ ${formatted}` : formatted;
}
const UNITS = ['', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function numberToPortuguese(n) {
    if (n === 0)
        return 'zero';
    if (n === 100)
        return 'cem';
    if (n < 10)
        return UNITS[n];
    if (n < 20)
        return TEENS[n - 10];
    if (n < 100) {
        const ten = Math.floor(n / 10);
        const unit = n % 10;
        return unit ? `${TENS[ten]} e ${UNITS[unit]}` : TENS[ten];
    }
    if (n < 1000) {
        const hundred = Math.floor(n / 100);
        const remainder = n % 100;
        return remainder ? `${HUNDREDS[hundred]} e ${numberToPortuguese(remainder)}` : HUNDREDS[hundred];
    }
    if (n < 1000000) {
        const thousands = Math.floor(n / 1000);
        const remainder = n % 1000;
        const prefix = thousands === 1 ? 'mil' : `${numberToPortuguese(thousands)} mil`;
        if (!remainder)
            return prefix;
        const connector = remainder < 100 ? ' e ' : ', ';
        return `${prefix}${connector}${numberToPortuguese(remainder)}`;
    }
    if (n < 1000000000) {
        const millions = Math.floor(n / 1000000);
        const remainder = n % 1000000;
        const prefix = millions === 1 ? 'um milhao' : `${numberToPortuguese(millions)} milhoes`;
        if (!remainder)
            return prefix;
        const connector = remainder < 100 ? ' e ' : ', ';
        return `${prefix}${connector}${numberToPortuguese(remainder)}`;
    }
    return String(n);
}
function moneyToWords(value) {
    const numeric = parseMoney(value);
    if (numeric == null)
        return '';
    const safe = Math.round(numeric * 100);
    const reais = Math.floor(safe / 100);
    const cents = safe % 100;
    const realLabel = reais === 1 ? 'real' : 'reais';
    const centLabel = cents === 1 ? 'centavo' : 'centavos';
    if (reais === 0 && cents > 0)
        return `${numberToPortuguese(cents)} ${centLabel}`;
    if (cents === 0)
        return `${numberToPortuguese(reais)} ${realLabel}`;
    return `${numberToPortuguese(reais)} ${realLabel} e ${numberToPortuguese(cents)} ${centLabel}`;
}
function dayWithWords(value) {
    const digits = digitsOnly(value).slice(0, 2);
    const day = Number(digits);
    if (!day || day > 31)
        return value.trim();
    return `${day} (${numberToPortuguese(day)})`;
}
function parseDateValue(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]) - 1;
        const day = Number(isoMatch[3]);
        return new Date(year, month, day);
    }
    const brMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (brMatch) {
        const day = Number(brMatch[1]);
        const month = Number(brMatch[2]) - 1;
        const year = Number(brMatch[3]);
        return new Date(year, month, day);
    }
    const native = new Date(trimmed);
    return Number.isNaN(native.getTime()) ? null : native;
}
function formatDateShort(value) {
    const parsed = parseDateValue(value);
    if (!parsed)
        return value.trim();
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `Dia ${day}/${month}/${year}`;
}
function formatDateLong(value) {
    const parsed = parseDateValue(value);
    if (!parsed)
        return value.trim();
    return parsed.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function normalizeContractField(key, value) {
    const trimmed = value.trim();
    if (!trimmed)
        return '';
    if (key === 'cnpjCliente')
        return formatCnpj(trimmed);
    if (key === 'cpfResponsavel')
        return formatCpf(trimmed);
    if (key === 'telefoneCliente')
        return formatPhone(trimmed);
    if (MONEY_KEYS.includes(key))
        return formatMoney(trimmed, key === 'valorParcela');
    if (DAY_KEYS.includes(key))
        return dayWithWords(trimmed);
    if (DATE_KEYS.includes(key))
        return formatDateShort(trimmed);
    if (key === 'dataContrato')
        return formatDateLong(trimmed);
    if (key === 'cidadeContrato')
        return toTitleCase(trimmed);
    return trimmed;
}
function mergeContractDraft(current, incoming) {
    const next = { ...current };
    for (const key of Object.keys(exports.CONTRACT_PLACEHOLDERS)) {
        const raw = incoming[key];
        if (typeof raw !== 'string')
            continue;
        const normalized = normalizeContractField(key, raw);
        if (normalized)
            next[key] = normalized;
    }
    return hydrateContractDraft(next);
}
function hydrateContractDraft(draft) {
    const next = { ...draft };
    if (next.valorMensal) {
        next.valorMensalExtenso = moneyToWords(next.valorMensal);
    }
    if (next.valorMensal && !next.valorParcela) {
        next.valorParcela = formatMoney(next.valorMensal, true);
    }
    return next;
}
function getMissingContractFields(draft) {
    const hydrated = hydrateContractDraft(draft);
    return Object.keys(exports.CONTRACT_PLACEHOLDERS).filter((key) => !hydrated[key].trim());
}
function getContractCompletion(draft) {
    const total = Object.keys(exports.CONTRACT_PLACEHOLDERS).length;
    const missing = getMissingContractFields(draft).length;
    return {
        total,
        filled: total - missing,
        percent: Math.round(((total - missing) / total) * 100),
    };
}
function applyContractTemplate(template, draft) {
    const hydrated = hydrateContractDraft(draft);
    let output = template;
    for (const key of Object.keys(exports.CONTRACT_PLACEHOLDERS)) {
        output = output.split(exports.CONTRACT_PLACEHOLDERS[key]).join(hydrated[key] || exports.CONTRACT_PLACEHOLDERS[key]);
    }
    return output;
}
function getRemainingPlaceholders(text) {
    return Array.from(new Set(text.match(/\{[A-Z0-9_]+\}/g) || []));
}
function buildContractConfirmationSummary(draft) {
    const hydrated = hydrateContractDraft(draft);
    return [
        'Perfeito! Vou confirmar os dados antes de gerar o contrato:',
        '',
        `EMPRESA: ${hydrated.nomeCliente} | CNPJ: ${hydrated.cnpjCliente}`,
        `RESPONSAVEL: ${hydrated.nomeResponsavel} | CPF: ${hydrated.cpfResponsavel}`,
        `PLATAFORMAS: ${hydrated.plataformas}`,
        `VALOR MENSAL: R$ ${hydrated.valorMensal} | Trafego minimo: R$ ${hydrated.valorMinimoTrafego}`,
        `NF: emitida ate dia ${hydrated.diaEmissaoNfSubsequente} | Vencimento: dia ${hydrated.diaVencimento}`,
        `PARCELAS: ${hydrated.vencimentoParcela1} | ${hydrated.vencimentoParcela2} | ${hydrated.vencimentoParcela3}`,
        `DATA/CIDADE: ${hydrated.dataContrato}, ${hydrated.cidadeContrato}`,
        '',
        'Esta tudo certo? Posso gerar o contrato?',
    ].join('\n');
}
function getChangedContractFields(previous, next) {
    const previousHydrated = hydrateContractDraft(previous);
    const nextHydrated = hydrateContractDraft(next);
    return Object.keys(exports.CONTRACT_PLACEHOLDERS).filter((key) => previousHydrated[key].trim() !== nextHydrated[key].trim());
}
function buildContractChangeConfirmation(draft, changedFields) {
    const hydrated = hydrateContractDraft(draft);
    const visibleChanges = changedFields.filter((field) => {
        if (!AUTO_DERIVED_FIELDS.includes(field))
            return true;
        if (field === 'valorMensalExtenso' && changedFields.includes('valorMensal'))
            return false;
        if (field === 'valorParcela' && changedFields.includes('valorMensal') && hydrated.valorParcela === formatMoney(hydrated.valorMensal, true)) {
            return false;
        }
        return true;
    });
    return [
        visibleChanges.length === 1
            ? 'Atualizei esse dado. Me confirma se ficou certo:'
            : 'Atualizei estes dados. Me confirma se ficou certo:',
        '',
        ...visibleChanges.map((field) => `- ${exports.CONTRACT_FIELD_LABELS[field]}: ${hydrated[field]}`),
        '',
        'Posso gerar o contrato agora?',
    ].join('\n');
}
function buildContractFileName(draft, now = new Date()) {
    const hydrated = hydrateContractDraft(draft);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const safeClient = (hydrated.nomeCliente || 'Cliente')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'Cliente';
    return `Contrato_${safeClient}_NGP_${month}_${year}`;
}
function getContractParagraphs(text) {
    return text
        .split(/\n{2,}/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
}
function isPositiveConfirmation(value) {
    const normalized = normalizeIntentText(value);
    if (!normalized)
        return false;
    if (/\bnao\b/.test(normalized) && /\b(gera|gerar|pode|confirmo|confirmado|ok|sim)\b/.test(normalized))
        return false;
    return [
        /\bsim\b/,
        /\bok(ay)?\b/,
        /\bpode\b/,
        /\bgera(r)?\b/,
        /\bconfirm(o|ado|ada)?\b/,
        /\bfech(ad[oa]|ou)\b/,
        /\btudo certo\b/,
        /\best[aá] tudo certo\b/,
        /\bpode seguir\b/,
    ].some((pattern) => pattern.test(normalized));
}
function getMissingGroups(draft) {
    const missing = new Set(getMissingContractFields(draft));
    return exports.CONTRACT_FIELD_GROUPS.filter((group) => group.fields.some((field) => missing.has(field)));
}
function buildContractMissingPrompt(draft) {
    const hydrated = hydrateContractDraft(draft);
    const missing = new Set(getMissingContractFields(hydrated));
    const nextGroup = exports.CONTRACT_FIELD_GROUPS.find((group) => group.fields.some((field) => missing.has(field)));
    if (!nextGroup)
        return 'Fechei a coleta. Vou te mostrar o resumo final para confirmar.';
    const missingLabels = nextGroup.fields
        .filter((field) => missing.has(field))
        .map((field) => exports.CONTRACT_FIELD_LABELS[field].toLowerCase());
    const joined = missingLabels.join(', ');
    if (nextGroup.id === 'empresa') {
        return `Me passa so o que falta da empresa: ${joined}.`;
    }
    if (nextGroup.id === 'responsavel') {
        return `Agora do responsavel legal, falta: ${joined}.`;
    }
    if (nextGroup.id === 'servico') {
        return `Do escopo e financeiro, falta: ${joined}.`;
    }
    if (nextGroup.id === 'pagamento') {
        return `Do pagamento, falta: ${joined}.`;
    }
    return `Pra fechar, falta: ${joined}.`;
}
