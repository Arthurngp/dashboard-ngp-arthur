-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket público de thumbnails de criativos para relatórios
-- ─────────────────────────────────────────────────────────────────────────────
-- Razão: thumbnails que vêm da Meta API (scontent-*.fbcdn.net) expiram em ~48h.
-- Quando o cliente abre um relatório antigo, as imagens quebram. A edge function
-- `relatorio-pin-thumb` baixa cada thumb e sobe pra cá, retornando URL permanente.
--
-- Bucket é público de leitura (relatórios são compartilhados via link) mas só
-- a service_role pode escrever (via edge function que valida sessão).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'relatorio-thumbs',
  'relatorio-thumbs',
  true,
  5242880, -- 5MB
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Policies: leitura pública (anônima OK), escrita só service_role.
-- Service role bypassa RLS, então não precisa policy de insert.

drop policy if exists "relatorio_thumbs_public_read" on storage.objects;
create policy "relatorio_thumbs_public_read"
  on storage.objects for select
  using (bucket_id = 'relatorio-thumbs');
