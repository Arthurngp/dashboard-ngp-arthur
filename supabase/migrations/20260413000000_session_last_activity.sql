-- Adiciona controle de última atividade na tabela de sessões
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity timestamptz DEFAULT now();
