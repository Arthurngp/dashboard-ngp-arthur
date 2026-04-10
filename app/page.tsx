'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    const sess = getSession()
    if (!sess) { router.replace('/login'); return }
    router.replace(sess.role === 'ngp' || sess.role === 'admin' ? '/setores' : '/cliente')
  }, [router])
  return null
}
