'use client'
import { useInactivityGuard } from '@/hooks/useInactivityGuard'

export default function InactivityGuard({ children }: { children: React.ReactNode }) {
  useInactivityGuard()
  return <>{children}</>
}
