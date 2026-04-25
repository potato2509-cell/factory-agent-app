// ============================================================================
// reportClassifier.js
// AZS Factory AI Agent System - 이슈 모드 자동 분류 (하이브리드)
// ============================================================================
// 분류 흐름:
//   STEP 1: 키워드 강제 체크   (API 0회) → DEEP 확정
//   STEP 2: 컬럼 빠른 체크      (API 0회) → DEEP 확정 / LITE 후보
//   STEP 3: AI 분류 라우터      (API 1회) → DEEP / STANDARD / LITE
//   STEP 4: 모드 확정 반환
//
// 입력: 이슈 객체 { title, content, status, priority, category, line, ... }
// 출력: { mode, reason, source, confidence }
// ----------------------------------------------------------------------------

import {
  CLASSIFIER_SYSTEM_PROMPT,
  buildClassifierUserMessage,
  DEEP_FORCE_KEYWORDS,
  SAFETY_BLOCK_KEYWORDS,
  MODEL_CONFIG,
} from './prompts.js';

// ===========================================================================
// 모드 상수
// ===========================================================================
export const MODE = {
  DEEP: 'DEEP',
  STANDARD: 'STANDARD',
  LITE: 'LITE',
};

// 분류 결과 source (어느 단계에서 확정되었는지)
export const CLASSIFY_SOURCE = {
  KEYWORD: 'keyword',     // STEP 1
  COLUMN: 'column',       // STEP 2
  AI: 'ai',               // STEP 3
  FALLBACK: 'fallback',   // AI 실패 시 폴백
};

// ===========================================================================
// 컬럼 값 정규화 (시트 표기 흔들림 흡수)
// ===========================================================================
const STATUS_DONE_VALUES = ['완료', '종료', 'closed', 'done', 'complete', 'completed'];
const PRIORITY_URGENT_VALUES = ['긴급', '🔴긴급', '🔴 긴급', 'urgent', 'critical', 'P1', '1'];

function isStatusDone(status) {
  if (!status) return false;
  const s = String(status).trim().toLowerCase();
  return STATUS_DONE_VALUES.some(v => s.includes(v.toLowerCase()));
}

function isPriorityUrgent(priority) {
  if (!priority) return false;
  const p = String(priority).trim().toLowerCase();
  return PRIORITY_URGENT_VALUES.some(v => p.includes(v.toLowerCase()));
}

// ===========================================================================
// STEP 1: 키워드 강제 체크 (API 0회)
// ===========================================================================
/**
 * @param {string} text - 검사할 텍스트 (title + content 결합 권장)
 * @returns {{matched: boolean, category: string|null, keyword: string|null}}
 */
export function checkDeepKeywords(text) {
  if (!text) return { matched: false, category: null, keyword: null };
  const lowered = String(text).toLowerCase();

  for (const [category, keywords] of Object.entries(DEEP_FORCE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowered.includes(kw.toLowerCase())) {
        return { matched: true, category, keyword: kw };
      }
    }
  }
  return { matched: false, category: null, keyword: null };
}

/**
 * 안전·환경 키워드가 있으면 LITE 후보 자격 박탈
 */
function hasSafetyBlocker(text) {
  if (!text) return false;
  const lowered = String(text).toLowerCase();
  return SAFETY_BLOCK_KEYWORDS.some(kw => lowered.includes(kw.toLowerCase()));
}

// ===========================================================================
// STEP 2: 컬럼 빠른 체크 (API 0회)
// ===========================================================================
/**
 * @returns {{decided: boolean, mode: string|null, reason: string|null}}
 *   decided=true 면 STEP 3 스킵
 *   decided=false 면 STEP 3로 진행
 */
export function checkColumns(issue, fullText) {
  // priority = 긴급 → DEEP 확정
  if (isPriorityUrgent(issue.priority)) {
    return {
      decided: true,
      mode: MODE.DEEP,
      reason: `우선순위 긴급(${issue.priority})`,
    };
  }

  // status = 완료 + 안전 키워드 없음 → LITE 후보로 STEP 3 스킵
  if (isStatusDone(issue.status) && !hasSafetyBlocker(fullText)) {
    return {
      decided: true,
      mode: MODE.LITE,
      reason: `완료 상태(${issue.status}) + 안전 키워드 없음`,
    };
  }

  // 그 외 → STEP 3로
  return { decided: false, mode: null, reason: null };
}

// ===========================================================================
// STEP 3: AI 분류 라우터 (이슈당 API 1회)
// ===========================================================================
/**
 * @param {object} issue
 * @param {function} apiCaller - async ({systemPrompt, userMessage, model, maxTokens}) => string
 *   prompts.js의 형식에 맞춘 호출 어댑터. discussionEngine.js 또는 외부에서 주입.
 * @returns {Promise<{mode: string, reason: string}>}
 */
export async function classifyByAI(issue, apiCaller) {
  const issueText = buildIssueText(issue);
  const statusInfo = buildStatusInfo(issue);

  const userMessage = buildClassifierUserMessage(issueText, statusInfo);

  let raw;
  try {
    raw = await apiCaller({
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
      userMessage,
      model: MODEL_CONFIG.fast.model,
      maxTokens: MODEL_CONFIG.fast.maxTokens,
    });
  } catch (err) {
    console.warn('[reportClassifier] AI 분류 호출 실패, STANDARD 폴백:', err?.message);
    return { mode: MODE.STANDARD, reason: 'AI 호출 실패 - 안전 폴백' };
  }

  // JSON 파싱 (모델이 가끔 앞뒤에 텍스트 붙임 → 추출)
  const parsed = extractJSON(raw);
  if (!parsed || !parsed.mode) {
    console.warn('[reportClassifier] JSON 파싱 실패, STANDARD 폴백. raw:', raw);
    return { mode: MODE.STANDARD, reason: 'AI 응답 파싱 실패 - 안전 폴백' };
  }

  const mode = String(parsed.mode).toUpperCase();
  if (!Object.values(MODE).includes(mode)) {
    console.warn('[reportClassifier] 알 수 없는 mode 값, STANDARD 폴백:', mode);
    return { mode: MODE.STANDARD, reason: `잘못된 mode: ${mode}` };
  }

  return {
    mode,
    reason: parsed.reason || '(AI 판단)',
  };
}

// ===========================================================================
// 통합 분류 함수 - 외부에서 호출하는 메인 API
// ===========================================================================
/**
 * 단일 이슈를 LITE/STANDARD/DEEP 중 하나로 분류
 * @param {object} issue - 이슈 객체
 * @param {function} apiCaller - AI 호출 어댑터 (prompts.js 형식)
 * @returns {Promise<{mode, reason, source, confidence}>}
 */
export async function classifyIssue(issue, apiCaller) {
  const fullText = buildIssueText(issue);

  // STEP 1: 키워드 강제
  const kw = checkDeepKeywords(fullText);
  if (kw.matched) {
    return {
      mode: MODE.DEEP,
      reason: `[${kw.category}] 키워드 감지: "${kw.keyword}"`,
      source: CLASSIFY_SOURCE.KEYWORD,
      confidence: 'high',
    };
  }

  // STEP 2: 컬럼
  const col = checkColumns(issue, fullText);
  if (col.decided) {
    return {
      mode: col.mode,
      reason: col.reason,
      source: CLASSIFY_SOURCE.COLUMN,
      confidence: 'high',
    };
  }

  // STEP 3: AI 분류
  const ai = await classifyByAI(issue, apiCaller);
  return {
    mode: ai.mode,
    reason: ai.reason,
    source: ai.reason.includes('폴백') ? CLASSIFY_SOURCE.FALLBACK : CLASSIFY_SOURCE.AI,
    confidence: ai.reason.includes('폴백') ? 'low' : 'medium',
  };
}

// ===========================================================================
// 배치 분류 - 다수 이슈 한 번에
// ===========================================================================
/**
 * @param {Array<object>} issues
 * @param {function} apiCaller
 * @param {object} options - { concurrency: 동시 호출 수 (기본 3) }
 * @returns {Promise<Array<{issue, classification}>>}
 */
export async function classifyIssues(issues, apiCaller, options = {}) {
  const concurrency = options.concurrency || 3;
  const results = [];
  const queue = [...issues];

  async function worker() {
    while (queue.length > 0) {
      const issue = queue.shift();
      if (!issue) break;
      try {
        const classification = await classifyIssue(issue, apiCaller);
        results.push({ issue, classification });
      } catch (err) {
        console.error('[reportClassifier] 분류 실패:', err);
        results.push({
          issue,
          classification: {
            mode: MODE.STANDARD,
            reason: `분류 중 오류: ${err.message}`,
            source: CLASSIFY_SOURCE.FALLBACK,
            confidence: 'low',
          },
        });
      }
    }
  }

  // concurrency 만큼 워커 동시 실행
  const workers = Array.from({ length: Math.min(concurrency, issues.length) }, () => worker());
  await Promise.all(workers);

  // 원래 순서 유지
  return issues.map(orig => results.find(r => r.issue === orig));
}

// ===========================================================================
// 분류 결과를 모드별로 그룹핑
// ===========================================================================
export function groupByMode(classifiedIssues) {
  const groups = { DEEP: [], STANDARD: [], LITE: [] };
  for (const item of classifiedIssues) {
    const m = item.classification.mode;
    if (groups[m]) groups[m].push(item);
  }
  return groups;
}

// ===========================================================================
// 헬퍼 - 이슈 → 텍스트 변환
// ===========================================================================
function buildIssueText(issue) {
  const parts = [];
  if (issue.title) parts.push(`제목: ${issue.title}`);
  if (issue.category) parts.push(`카테고리: ${issue.category}`);
  if (issue.line) parts.push(`라인: ${issue.line}`);
  if (issue.content) parts.push(`내용: ${issue.content}`);
  if (issue.body) parts.push(`내용: ${issue.body}`);  // 컬럼 명 흔들림 대비
  return parts.join('\n');
}

function buildStatusInfo(issue) {
  const parts = [];
  if (issue.status) parts.push(`상태: ${issue.status}`);
  if (issue.priority) parts.push(`우선순위: ${issue.priority}`);
  if (issue.updated_at) parts.push(`등록시각: ${issue.updated_at}`);
  return parts.join(' / ');
}

// ===========================================================================
// 헬퍼 - 모델 응답에서 JSON 추출 (앞뒤 텍스트 제거)
// ===========================================================================
function extractJSON(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();

  // 1차: 그대로 파싱
  try { return JSON.parse(trimmed); } catch (_) {}

  // 2차: 첫 { 부터 마지막 } 까지 추출
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const candidate = trimmed.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch (_) {}

  return null;
}
