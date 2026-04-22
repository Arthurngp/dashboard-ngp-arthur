'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminClientesRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/usuarios?tab=clientes')
  }, [router])

  return null
}
