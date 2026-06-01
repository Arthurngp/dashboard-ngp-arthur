-- Cache de transcrições de vídeos de criativos da Meta.
-- video_id é estável globalmente — mesma chave reaproveita texto sem
-- precisar baixar+transcrever de novo (economiza tempo e crédito Whisper).
create table if not exists relatorio_transcricoes (
  video_id text primary key,
  texto text not null,
  duracao_seg integer,
  bytes_video integer,
  created_at timestamptz default now()
);

-- Apenas role de servidor lê/escreve. Sem RLS aberta — edge function usa
-- service role, então não precisa policy permissiva.
alter table relatorio_transcricoes enable row level security;
