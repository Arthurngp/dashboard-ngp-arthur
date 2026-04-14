import type { Metadata } from 'next'
import './globals.css'
import InactivityGuard from '@/components/InactivityGuard'

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
      <body><InactivityGuard>{children}</InactivityGuard></body>
    </html>
  )
}
