CREATE TABLE IF NOT EXISTS public.cliente_portal_acessos (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  analytics_enabled boolean NOT NULL DEFAULT true,
  reports_enabled boolean NOT NULL DEFAULT true,
  crm_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS cliente_portal_acessos_crm_idx
  ON public.cliente_portal_acessos (crm_enabled, updated_at DESC);

INSERT INTO public.cliente_portal_acessos (
  usuario_id,
  analytics_enabled,
  reports_enabled,
  crm_enabled
)
SELECT
  u.id,
  true,
  true,
  EXISTS (
    SELECT 1
    FROM public.crm_pipelines p
    WHERE p.cliente_id = u.id
      AND p.is_active = true
  )
FROM public.usuarios u
WHERE u.role = 'cliente'
ON CONFLICT (usuario_id) DO UPDATE
SET
  analytics_enabled = EXCLUDED.analytics_enabled,
  reports_enabled = EXCLUDED.reports_enabled,
  crm_enabled = EXCLUDED.crm_enabled,
  updated_at = timezone('utc', now());
