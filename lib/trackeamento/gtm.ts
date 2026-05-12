/**
 * GTM (Google Tag Manager) integration for NGP Forms.
 * Injects the container script once per page and provides
 * typed helpers for every form lifecycle event.
 */

declare global {
  interface Window {
    dataLayer: Record<string, unknown>[];
  }
}

// ── Core ──────────────────────────────────────────────────────────

function initDataLayer() {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
}

export function pushEvent(event: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  initDataLayer();
  window.dataLayer.push(event);
}

/**
 * Injects the GTM script tag into <head> once.
 * Safe to call multiple times — checks for existing injection.
 */
export function injectGTM(containerId: string): boolean {
  if (typeof window === 'undefined') return false;
  if (!containerId || !containerId.match(/^GTM-[A-Z0-9]+$/i)) return false;
  if (document.querySelector(`script[data-ngp-gtm="${containerId}"]`)) return true;

  initDataLayer();
  pushEvent({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

  // Main script
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`;
  script.setAttribute('data-ngp-gtm', containerId);
  document.head.appendChild(script);

  // Noscript fallback
  const noscript = document.createElement('noscript');
  noscript.innerHTML = `<iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`;
  document.body.insertBefore(noscript, document.body.firstChild);

  return true;
}

// ── Typed events ──────────────────────────────────────────────────

/** Fired when the form is opened and the first slide renders. */
export function gtmFormStart(formId: string, formTitle: string) {
  pushEvent({
    event: 'ngp_form_start',
    form_id: formId,
    form_title: formTitle,
  });
}

/** Fired every time a question slide becomes active. */
export function gtmQuestionView(params: {
  formId: string;
  questionIndex: number; // 1-based
  questionId: string;
  questionTitle: string;
  questionType: string;
}) {
  pushEvent({
    event: 'ngp_question_view',
    form_id: params.formId,
    question_index: params.questionIndex,
    question_id: params.questionId,
    question_title: params.questionTitle,
    question_type: params.questionType,
  });
}

/** Fired when the user submits an answer and moves forward. */
export function gtmQuestionAnswer(params: {
  formId: string;
  questionId: string;
  questionTitle: string;
  questionType: string;
  answerValue: unknown;
  timeToAnswerMs: number;
}) {
  // Redact PII field types
  const piiTypes = ['email', 'phone', 'url'];
  const safeAnswer = piiTypes.includes(params.questionType)
    ? '[redacted]'
    : params.answerValue;

  pushEvent({
    event: 'ngp_question_answer',
    form_id: params.formId,
    question_id: params.questionId,
    question_title: params.questionTitle,
    question_type: params.questionType,
    answer_value: safeAnswer,
    time_to_answer_ms: params.timeToAnswerMs,
  });
}

/** Fired when the form is successfully submitted. */
export function gtmFormComplete(params: {
  formId: string;
  formTitle: string;
  totalQuestions: number;
  answeredQuestions: number;
  completionTimeMs: number;
}) {
  pushEvent({
    event: 'ngp_form_complete',
    form_id: params.formId,
    form_title: params.formTitle,
    total_questions: params.totalQuestions,
    answered_questions: params.answeredQuestions,
    completion_time_ms: params.completionTimeMs,
  });
}

/** Fired on beforeunload when the form was not completed. */
export function gtmFormAbandon(params: {
  formId: string;
  formTitle: string;
  lastQuestionIndex: number;
  lastQuestionTitle: string;
  questionsAnswered: number;
  totalQuestions: number;
}) {
  pushEvent({
    event: 'ngp_form_abandon',
    form_id: params.formId,
    form_title: params.formTitle,
    last_question_index: params.lastQuestionIndex,
    last_question_title: params.lastQuestionTitle,
    questions_answered: params.questionsAnswered,
    total_questions: params.totalQuestions,
  });
}
