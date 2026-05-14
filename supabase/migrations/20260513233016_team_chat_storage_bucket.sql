-- Bucket privado para anexos do chat interno
-- Path organizado: team-chat/{channel_id}/{yyyy}/{mm}/{dd}/{uuid}-{filename}
-- Limite: 50MB por arquivo (validado também no app)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'team-chat-attachments',
  'team-chat-attachments',
  false,
  52428800,
  ARRAY[
    'image/jpeg','image/png','image/webp','image/gif','image/svg+xml',
    'video/mp4','video/quicktime','video/webm',
    'application/pdf',
    'text/csv','text/html','text/plain',
    'application/zip','application/x-zip-compressed',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword','application/vnd.ms-excel'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS team_chat_attachments_storage_select ON storage.objects;
CREATE POLICY team_chat_attachments_storage_select
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'team-chat-attachments'
    AND public.team_chat_can_access_channel(
      ((string_to_array(name, '/'))[1])::uuid
    )
  );

DROP POLICY IF EXISTS team_chat_attachments_storage_insert ON storage.objects;
CREATE POLICY team_chat_attachments_storage_insert
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'team-chat-attachments'
    AND public.team_chat_can_access_channel(
      ((string_to_array(name, '/'))[1])::uuid
    )
  );

DROP POLICY IF EXISTS team_chat_attachments_storage_delete ON storage.objects;
CREATE POLICY team_chat_attachments_storage_delete
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'team-chat-attachments'
    AND public.team_chat_is_admin()
  );
