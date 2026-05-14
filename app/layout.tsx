import type { Metadata } from 'next'
import './globals.css'
import InactivityGuard from '@/components/InactivityGuard'
import FeedbackFloatingButton from '@/components/FeedbackFloatingButton'
import ChatFloatingButton from '@/components/ChatFloatingButton'

const CHAT_ENABLED = process.env.NEXT_PUBLIC_INTERNAL_CHAT_ENABLED === 'true'

export const metadata: Metadata = {
  title: 'NGP Space',
  description: 'Sistema geral de gestão NGP',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <InactivityGuard>{children}</InactivityGuard>
        {CHAT_ENABLED ? (
          <>
            <ChatFloatingButton />
            <FeedbackFloatingButton hideTrigger />
          </>
        ) : (
          <FeedbackFloatingButton />
        )}
      </body>
    </html>
  )
}
