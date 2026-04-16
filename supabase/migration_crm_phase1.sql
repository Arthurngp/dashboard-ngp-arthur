-- ═══════════════════════════════════════════════════════════════════════════════
-- NGP CRM — Fase 1: Timeline de Atividades + Sistema de Tarefas
-- Execute este script no Supabase Dashboard > SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Tabela: crm_activities (Timeline de Atividades por Lead) ───────────────
CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,

  -- Tipo da atividade
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'nota_interna',
    'mudanca_etapa', 'mudanca_responsavel', 'edicao_campo', 'criacao_lead'
  )),

  -- Conteúdo
  title TEXT NOT NULL,
  description TEXT,

  -- Contexto de mudanças automáticas
  -- Ex: { "from_stage": "Prospecção", "to_stage": "Qualificação" }
  -- Ex: { "field": "email", "old": "a@b.com", "new": "c@d.com" }
  metadata JSONB DEFAULT '{}',

  -- Quem registrou
  created_by UUID REFERENCES usuarios(id),
  created_by_name TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Duração (para ligações/reuniões)
  duration_minutes INT
);

CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON crm_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_type ON crm_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_crm_activities_created ON crm_activities(created_at DESC);


-- ─── Tabela: crm_tasks (Tarefas/Follow-ups por Lead) ────────────────────────
CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,

  -- Conteúdo da tarefa
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL CHECK (task_type IN (
    'ligar', 'enviar_email', 'enviar_whatsapp', 'agendar_reuniao',
    'enviar_proposta', 'follow_up', 'outro'
  )),

  -- Agendamento
  due_date TIMESTAMPTZ NOT NULL,
  due_time TEXT, -- "14:30"

  -- Status
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida', 'atrasada', 'cancelada')),
  completed_at TIMESTAMPTZ,

  -- Responsável
  assigned_to UUID REFERENCES usuarios(id),
  assigned_to_name TEXT,
  created_by UUID REFERENCES usuarios(id),
  created_by_name TEXT,

  -- Prioridade
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa', 'normal', 'alta', 'urgente')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_lead ON crm_tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON crm_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due ON crm_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status ON crm_tasks(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FIM DA MIGRAÇÃO
-- ═══════════════════════════════════════════════════════════════════════════════
