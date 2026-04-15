ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_role_archived
  ON usuarios (role, archived_at);

CREATE INDEX IF NOT EXISTS idx_usuarios_archived_by
  ON usuarios (archived_by);
