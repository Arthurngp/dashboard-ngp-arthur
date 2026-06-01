#!/usr/bin/env node
/**
 * Backup do chat interno NGP.
 *
 * Chama a RPC `team_chat_backup_dump` (SECURITY DEFINER, exige admin)
 * e salva o JSON resultante em ~/ngp-chat-backups/team-chat-YYYY-MM-DD.json
 *
 * Uso:
 *   NGP_ADMIN_SESSION_TOKEN=<seu-token> node scripts/backup-team-chat.mjs
 *
 * Como pegar o token:
 *   1. Faça login no NGP Space como admin (@sejangp.com.br + role='admin')
 *   2. Abra DevTools → Application → Session Storage → adsboard_session
 *   3. Copie o valor e exporte na sessão do terminal:
 *      export NGP_ADMIN_SESSION_TOKEN="..."
 *
 * Lê NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON de .env.local.
 *
 * Anexos físicos no Storage NÃO são incluídos — apenas a referência storage_path.
 * Para arquivos: dashboard Supabase → Storage → team-chat-attachments.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const ENV_PATH = join(PROJECT_ROOT, '.env.local')

function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.error(`✗ .env.local não encontrado em ${ENV_PATH}`)
    process.exit(1)
  }
  const env = {}
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

async function main() {
  const env = loadEnv()
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON
  const sessionToken = process.env.NGP_ADMIN_SESSION_TOKEN

  if (!supabaseUrl || !anonKey) {
    console.error('✗ Faltam NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON em .env.local')
    process.exit(1)
  }

  if (!sessionToken) {
    console.error('✗ NGP_ADMIN_SESSION_TOKEN não definido.')
    console.error('  Como obter: login no NGP Space como admin →')
    console.error('  DevTools → Application → Session Storage → adsboard_session')
    console.error('  Depois: export NGP_ADMIN_SESSION_TOKEN="..."')
    process.exit(1)
  }

  console.log('→ Chamando RPC team_chat_backup_dump…')

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/team_chat_backup_dump`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'x-session-token': sessionToken,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`✗ Falha: ${res.status} ${body}`)
    if (res.status === 401 || /administradores/.test(body)) {
      console.error('  Verifique se o NGP_ADMIN_SESSION_TOKEN é de uma sessão admin válida (@sejangp + role=admin)')
    }
    process.exit(1)
  }

  const dump = await res.json()

  // Resumo de contagens
  const counts = {}
  for (const [k, v] of Object.entries(dump)) {
    if (Array.isArray(v)) counts[k] = v.length
  }

  console.log('  Conteúdo:')
  for (const [k, n] of Object.entries(counts)) {
    console.log(`    • ${k}: ${n} linhas`)
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)

  const backupDir = join(homedir(), 'ngp-chat-backups')
  mkdirSync(backupDir, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(backupDir, `team-chat-${stamp}.json`)
  writeFileSync(file, JSON.stringify(dump, null, 2))

  console.log(`\n✓ Backup salvo em: ${file}`)
  console.log(`  ${total} linhas no total\n`)
  console.log('  ⚠ Anexos físicos no Storage NÃO são incluídos.')
  console.log('    Para baixar arquivos: dashboard Supabase → Storage → team-chat-attachments')
}

main().catch((e) => {
  console.error('✗ Backup falhou:', e)
  process.exit(1)
})
