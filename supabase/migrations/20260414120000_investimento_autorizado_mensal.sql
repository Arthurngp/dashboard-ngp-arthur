ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS investimento_autorizado_mensal numeric(12,2);
