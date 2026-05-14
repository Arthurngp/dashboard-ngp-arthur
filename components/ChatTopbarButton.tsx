'use client'

import Link from 'next/link'
import { useChannels } from '@/lib/team-chat'
import styles from './WorkspaceTopbar.module.css'

export default function ChatTopbarButton() {
  const { channels } = useChannels()
  const unread = channels.reduce((sum, c) => sum + (c.unread_count || 0), 0)

  return (
    <Link
      href="/chat"
      className={styles.chatButton}
      aria-label="Chat NGP"
      title={unread > 0 ? `${unread} mensagens não lidas` : 'Chat NGP'}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        width={18}
        height={18}
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      {unread > 0 && (
        <span className={styles.chatButtonBadge}>{unread > 99 ? '99+' : unread}</span>
      )}
    </Link>
  )
}
