'use client'
import React from 'react'
import styles from './NGPLoading.module.css'

interface NGPLoadingProps {
  loading?: boolean
  success?: boolean
  loadingText?: string
  successText?: string
}

export default function NGPLoading({ 
  loading = false, 
  success = false, 
  loadingText = 'Carregando...', 
  successText = 'Ponto Registrado!' 
}: NGPLoadingProps) {
  if (!loading && !success) return null

  return (
    <>
      {success && (
        <div className={styles.successOverlay}>
          <div className={styles.successCircle}>
            <svg className={styles.checkmark} viewBox="0 0 52 52">
              <circle className={styles.checkmarkCircle} cx="26" cy="26" r="25" fill="none" />
              <path className={styles.checkmarkCheck} fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
            </svg>
          </div>
          <div className={styles.successText}>{successText}</div>
        </div>
      )}

      {loading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.lettersContainer}>
            <span className={styles.animLetterN}>N</span>
            <span className={styles.animLetterG}>G</span>
            <span className={styles.animLetterP}>P</span>
          </div>
          <div className={styles.loadingText}>{loadingText}</div>
        </div>
      )}
    </>
  )
}
