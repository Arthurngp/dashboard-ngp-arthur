'use client'
import React from 'react'
import Image from 'next/image'
import { fmt } from '@/lib/utils'
import { BudgetAlert } from '../types'
import styles from '../dashboard.module.css'

interface NotificacoesTabProps {
  alertsLoading: boolean
  budgetAlerts: BudgetAlert[]
  alertsDismissed: Set<string>
  clients: any[]
  onLoadBudgetAlerts: () => void
  onDismissAlert: (key: string) => void
  onClearDismissed: () => void
}

export default function NotificacoesTab({
  alertsLoading, budgetAlerts, alertsDismissed, clients,
  onLoadBudgetAlerts, onDismissAlert, onClearDismissed,
}: NotificacoesTabProps) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#111', letterSpacing: '-.02em' }}>🔔 Notificações — Saldo e Pagamento</div>
          <div style={{ fontSize: 12, color: '#6E6E73', marginTop: 4 }}>Verifica saldo da conta, limite de gasto e problemas de pagamento de todos os clientes</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onLoadBudgetAlerts}
            disabled={alertsLoading}
            style={{ background: '#111', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'Sora,sans-serif', opacity: alertsLoading ? 0.6 : 1 }}
          >
            {alertsLoading ? 'Verificando...' : '↻ Atualizar'}
          </button>
          {alertsDismissed.size > 0 && (
            <button
              onClick={onClearDismissed}
              style={{ background: 'transparent', border: '1px solid #E5E5EA', borderRadius: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#6E6E73', fontFamily: 'Sora,sans-serif' }}
            >
              Mostrar dispensados ({alertsDismissed.size})
            </button>
          )}
        </div>
      </div>

      {alertsLoading && (
        <div className={styles.loadingBar}><div className={styles.spinner} /> Verificando saldo e pagamento dos clientes...</div>
      )}

      {!alertsLoading && budgetAlerts.length === 0 && (
        <div className={styles.empty}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
          Nenhum alerta no momento. Todos os clientes estão com saldo e pagamento em dia.
        </div>
      )}

      {!alertsLoading && budgetAlerts.length > 0 && (() => {
        const visible = budgetAlerts.filter(a => !alertsDismissed.has(`${a.clientId}_${a.issue}`))
        const criticalCount = visible.filter(a => a.severity === 'critical').length
        const warningCount = visible.filter(a => a.severity === 'warning').length
        const infoCount = visible.filter(a => a.severity === 'info').length

        return (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              {criticalCount > 0 && <div style={{ background: '#FEE2E2', color: '#DC2626', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>🔴 {criticalCount} crítico{criticalCount > 1 ? 's' : ''}</div>}
              {warningCount > 0 && <div style={{ background: '#FEF3C7', color: '#D97706', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>🟡 {warningCount} atenção</div>}
              {infoCount > 0 && <div style={{ background: '#DBEAFE', color: '#2563EB', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>ℹ️ {infoCount} info</div>}
              <div style={{ background: '#F3F4F6', color: '#6E6E73', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{clients.length} clientes verificados</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visible.map(alert => {
                const key = `${alert.clientId}_${alert.issue}`
                const borderColor = alert.severity === 'critical' ? '#DC2626' : alert.severity === 'warning' ? '#D97706' : '#3B82F6'
                const bgColor = alert.severity === 'critical' ? '#FFF5F5' : alert.severity === 'warning' ? '#FFFBEB' : '#F0F9FF'
                const sevLabel = alert.severity === 'critical' ? '🔴 CRÍTICO' : alert.severity === 'warning' ? '🟡 ATENÇÃO' : 'ℹ️ INFO'
                const issueIcon = alert.issue === 'card_declined' || alert.issue === 'unsettled' ? '💳' : alert.issue === 'account_disabled' ? '🚫' : alert.issue === 'no_balance' || alert.issue === 'low_balance' ? '💰' : alert.issue === 'no_account' ? '⚙️' : '📊'
                const pctUsed = alert.spendCap > 0 ? (alert.amountSpent / alert.spendCap * 100) : 0

                return (
                  <div key={key} style={{ background: bgColor, border: `1.5px solid ${borderColor}20`, borderLeft: `4px solid ${borderColor}`, borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, transition: 'all .15s' }}>
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: 'linear-gradient(135deg,#2563eb,#38bdf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800, flexShrink: 0, overflow: 'hidden', position: 'relative' }}>
                      {alert.clientFoto
                        ? <Image src={alert.clientFoto} alt={alert.clientName} fill style={{ objectFit: 'cover' }} />
                        : alert.clientName.slice(0, 2).toUpperCase()
                      }
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{alert.clientName}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${borderColor}18`, color: borderColor }}>{sevLabel}</span>
                        {alert.accountId && <span style={{ fontSize: 10, color: '#AEAEB2', fontFamily: "'JetBrains Mono',monospace" }}>act_{alert.accountId}</span>}
                      </div>

                      <div style={{ fontSize: 13, color: '#374151', fontWeight: 600, marginBottom: 4 }}>{issueIcon} {alert.issueLabel}</div>

                      {alert.spendCap > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ flex: 1, height: 6, background: '#E5E5EA', borderRadius: 3, overflow: 'hidden', maxWidth: 220 }}>
                            <div style={{ height: '100%', borderRadius: 3, background: pctUsed >= 95 ? '#DC2626' : pctUsed >= 80 ? '#D97706' : '#16A34A', width: `${Math.min(pctUsed, 100)}%`, transition: 'width .3s' }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#6E6E73', whiteSpace: 'nowrap' }}>R$ {fmt(alert.amountSpent)} gasto de R$ {fmt(alert.spendCap)}</span>
                        </div>
                      )}

                      {alert.accountId && alert.issue !== 'no_account' && (
                        <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
                          {alert.amountSpent > 0 && <span style={{ fontSize: 11, color: '#6E6E73' }}>Total gasto: <strong style={{ color: '#111' }}>R$ {fmt(alert.amountSpent)}</strong></span>}
                          {alert.balance > 0 && <span style={{ fontSize: 11, color: '#6E6E73' }}>Saldo pendente: <strong style={{ color: '#DC2626' }}>R$ {fmt(alert.balance)}</strong></span>}
                          {alert.spendCap > 0 && <span style={{ fontSize: 11, color: '#6E6E73' }}>Restante: <strong style={{ color: alert.severity === 'critical' ? '#DC2626' : '#16A34A' }}>R$ {fmt(Math.max(alert.spendCap - alert.amountSpent, 0))}</strong></span>}
                        </div>
                      )}

                      {alert.issue === 'no_account' && (
                        <div style={{ fontSize: 11, color: '#D97706', marginTop: 4, fontWeight: 600 }}>⚠️ Vá em Vincular Contas para configurar a conta Meta deste cliente</div>
                      )}
                    </div>

                    <button onClick={() => onDismissAlert(key)} title="Dispensar" style={{ background: 'transparent', border: '1px solid #E5E5EA', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, color: '#AEAEB2', fontFamily: 'Sora,sans-serif', flexShrink: 0 }}>
                      ✕
                    </button>
                  </div>
                )
              })}

              {visible.length === 0 && alertsDismissed.size > 0 && (
                <div className={styles.empty}>
                  Todos os alertas foram dispensados. Clique em &quot;Mostrar dispensados&quot; para restaurar.
                </div>
              )}
            </div>
          </>
        )
      })()}
    </>
  )
}
