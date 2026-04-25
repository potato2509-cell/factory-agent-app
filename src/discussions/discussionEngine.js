// ============================================================================
// discussionEngine.js
// AZS Factory AI Agent System - 논의 엔진 (라우터 → 순차 호출 → 사회자)
// ============================================================================
// 모드별 분기:
//   LITE:     사회자 1회 단독 호출
//   STANDARD: 라우터 → 3 페르소나 → 사회자(액션플랜)  = 5회
//   DEEP:     라우터 → 3 페르소나 → 사회자(5섹션)     = 5회
//
// API 호출 어댑터(apiCaller)는 외부에서 주입.
// 시그니처: async ({systemPrompt, userMessage, model, maxTokens}) => string
// ----------------------------------------------------------------------------

import {
  buildPersonaSystemPrompt,
  buildPersonaUserMessage,
  ROUTER_SYSTEM_PROMPT,
  buildRouterUserMessage,
  MODERATOR_DEEP_SYSTEM_PROMPT,
  buildModeratorDeepUserMessage,
  MODERATOR_STANDARD_SYSTEM_PROMPT,
  buildModeratorStandardUserMessage,
  MODERATOR_LITE_SYSTEM_PROMPT,
  buildModeratorLiteUserMessage,
  MODEL_CONFIG,
  PERSONAS,
} from './prompts.js';

import { MODE } from './reportClassifier.js';

// ===========================================================================
// 기본 라우터 결과 (라우터 호출 실패 시 폴백)
// ===========================================================================
const DEFAULT_ORDER = ['TE', 'ME', 'PE'];  // 불량 우선 가정 (가장 흔한 케이스)

// ===========================================================================
// 메인 진입점 - 단일 이슈 논의 실행
// ===========================================================================
/**
 * @param {object} params
 * @param {string} params.issueText - 이슈 본문 (title + content 결합)
 * @param {string} params.mode - 'DEEP' | 'STANDARD' | 'LITE'
 * @param {object} params.learningContext - { PE: '...', ME: '...', TE: '...', FA: '...', VISION: '...' }
 *   페르소나별 학습 데이터 (선택)
 * @param {function} params.apiCaller - AI 호출 어댑터
 * @param {object} [params.options]
 * @param {Array<string>} [params.options.forceParticipants] - 강제 참여 페르소나 (FA/Vision 추가용)
 * @returns {Promise<DiscussionResult>}
 */
export async function runDiscussion({
  issueText,
  mode,
  learningContext = {},
  apiCaller,
  options = {},
}) {
  if (!issueText) throw new Error('issueText is required');
  if (!apiCaller) throw new Error('apiCaller is required');

  const startTime = Date.now();
  const apiCalls = [];  // 디버깅/비용 추적용

  // === LITE 모드: 사회자만 호출 ===
  if (mode === MODE.LITE) {
    const result = await runLiteMode({ issueText, apiCaller, apiCalls });
    return {
      mode: MODE.LITE,
      issueText,
      router: null,
      opinions: [],
      moderator: result,
      apiCalls,
      elapsedMs: Date.now() - startTime,
    };
  }

  // === STANDARD / DEEP: 라우터 → 페르소나 순차 → 사회자 ===

  // [1] 라우터 호출
  const router = await runRouter({
    issueText,
    apiCaller,
    apiCalls,
    forceParticipants: options.forceParticipants,
  });

  // [2~4] 페르소나 순차 호출
  const opinions = await runPersonasSequentially({
    issueText,
    order: router.order,
    learningContext,
    apiCaller,
    apiCalls,
  });

  // [5] 사회자 호출 (모드별 분기)
  const moderator = mode === MODE.DEEP
    ? await runModeratorDeep({ issueText, opinions, apiCaller, apiCalls })
    : await runModeratorStandard({ issueText, opinions, apiCaller, apiCalls });

  return {
    mode,
    issueText,
    router,
    opinions,
    moderator,
    apiCalls,
    elapsedMs: Date.now() - startTime,
  };
}

// ===========================================================================
// LITE 모드 - 사회자 1회
// ===========================================================================
async function runLiteMode({ issueText, apiCaller, apiCalls }) {
  const t0 = Date.now();
  const text = await apiCaller({
    systemPrompt: MODERATOR_LITE_SYSTEM_PROMPT,
    userMessage: buildModeratorLiteUserMessage(issueText),
    model: MODEL_CONFIG.reasoning.model,
    maxTokens: MODEL_CONFIG.reasoning.maxTokens,
  });
  apiCalls.push({ stage: 'moderator-lite', model: MODEL_CONFIG.reasoning.model, ms: Date.now() - t0 });
  return { type: 'lite', text };
}

// ===========================================================================
// 라우터 - 발언 순서 결정
// ===========================================================================
async function runRouter({ issueText, apiCaller, apiCalls, forceParticipants }) {
  const t0 = Date.now();
  let raw;
  try {
    raw = await apiCaller({
      systemPrompt: ROUTER_SYSTEM_PROMPT,
      userMessage: buildRouterUserMessage(issueText),
      model: MODEL_CONFIG.fast.model,
      maxTokens: MODEL_CONFIG.fast.maxTokens,
    });
    apiCalls.push({ stage: 'router', model: MODEL_CONFIG.fast.model, ms: Date.now() - t0 });
  } catch (err) {
    console.warn('[discussionEngine] 라우터 호출 실패, 기본 순서 사용:', err?.message);
    return { order: DEFAULT_ORDER, reason: '라우터 호출 실패 - 기본 순서', source: 'fallback' };
  }

  const parsed = extractJSON(raw);
  let order = parsed?.order;
  const reason = parsed?.reason || '(라우터 판단)';

  // 검증
  if (!Array.isArray(order) || order.length === 0) {
    console.warn('[discussionEngine] 라우터 응답 파싱 실패, 기본 순서 사용. raw:', raw);
    order = DEFAULT_ORDER;
  }

  // 페르소나 코드 정규화 + 알 수 없는 코드 제거
  order = order
    .map(c => String(c).toUpperCase())
    .filter(c => PERSONAS[c]);

  // 강제 참여자 병합 (중복 제거)
  if (Array.isArray(forceParticipants)) {
    for (const p of forceParticipants) {
      const code = String(p).toUpperCase();
      if (PERSONAS[code] && !order.includes(code)) {
        order.push(code);
      }
    }
  }

  // 최소 3명 보장
  if (order.length < 3) {
    for (const fallback of DEFAULT_ORDER) {
      if (!order.includes(fallback)) order.push(fallback);
      if (order.length >= 3) break;
    }
  }

  // 최대 5명 제한
  if (order.length > 5) order = order.slice(0, 5);

  return { order, reason, source: parsed ? 'router' : 'fallback' };
}

// ===========================================================================
// 페르소나 순차 호출 - 이전 의견을 누적해서 다음 페르소나에게 전달
// ===========================================================================
async function runPersonasSequentially({
  issueText, order, learningContext, apiCaller, apiCalls,
}) {
  const opinions = [];

  for (const code of order) {
    const t0 = Date.now();
    const learning = learningContext[code] || '';

    let opinion;
    try {
      opinion = await apiCaller({
        systemPrompt: buildPersonaSystemPrompt(code, learning),
        userMessage: buildPersonaUserMessage(issueText, opinions),
        model: MODEL_CONFIG.reasoning.model,
        maxTokens: MODEL_CONFIG.reasoning.maxTokens,
      });
    } catch (err) {
      console.warn(`[discussionEngine] ${code} 호출 실패:`, err?.message);
      opinion = `(${code} 의견 수집 실패: ${err?.message || '알 수 없는 오류'})`;
    }

    apiCalls.push({
      stage: `persona-${code}`,
      model: MODEL_CONFIG.reasoning.model,
      ms: Date.now() - t0,
    });

    opinions.push({
      persona: code,
      personaFullName: PERSONAS[code]?.fullName || code,
      opinion: String(opinion).trim(),
    });
  }

  return opinions;
}

// ===========================================================================
// 사회자 - DEEP (5섹션)
// ===========================================================================
async function runModeratorDeep({ issueText, opinions, apiCaller, apiCalls }) {
  const t0 = Date.now();
  let text;
  try {
    text = await apiCaller({
      systemPrompt: MODERATOR_DEEP_SYSTEM_PROMPT,
      userMessage: buildModeratorDeepUserMessage(issueText, opinions),
      model: MODEL_CONFIG.reasoningLong.model,
      maxTokens: MODEL_CONFIG.reasoningLong.maxTokens,
    });
  } catch (err) {
    console.warn('[discussionEngine] 사회자(DEEP) 호출 실패:', err?.message);
    text = `(사회자 종합 실패: ${err?.message})\n\n[수집된 의견]\n` +
      opinions.map(o => `── ${o.persona} ──\n${o.opinion}`).join('\n\n');
  }
  apiCalls.push({ stage: 'moderator-deep', model: MODEL_CONFIG.reasoningLong.model, ms: Date.now() - t0 });
  return { type: 'deep', text };
}

// ===========================================================================
// 사회자 - STANDARD (액션 플랜)
// ===========================================================================
async function runModeratorStandard({ issueText, opinions, apiCaller, apiCalls }) {
  const t0 = Date.now();
  let text;
  try {
    text = await apiCaller({
      systemPrompt: MODERATOR_STANDARD_SYSTEM_PROMPT,
      userMessage: buildModeratorStandardUserMessage(issueText, opinions),
      model: MODEL_CONFIG.reasoning.model,
      maxTokens: MODEL_CONFIG.reasoning.maxTokens,
    });
  } catch (err) {
    console.warn('[discussionEngine] 사회자(STANDARD) 호출 실패:', err?.message);
    text = `(사회자 종합 실패: ${err?.message})\n\n[수집된 의견]\n` +
      opinions.map(o => `── ${o.persona} ──\n${o.opinion}`).join('\n\n');
  }
  apiCalls.push({ stage: 'moderator-standard', model: MODEL_CONFIG.reasoning.model, ms: Date.now() - t0 });
  return { type: 'standard', text };
}

// ===========================================================================
// 배치 실행 - 다수 이슈 (모드별로 이미 분류된 상태에서)
// ===========================================================================
/**
 * @param {Array<{issue, classification}>} classifiedIssues - reportClassifier 결과
 * @param {object} params - { learningContext, apiCaller, options, concurrency }
 * @returns {Promise<Array<{issue, classification, discussion}>>}
 */
export async function runDiscussionsForIssues(classifiedIssues, params) {
  const { learningContext = {}, apiCaller, options = {}, concurrency = 2 } = params;
  if (!apiCaller) throw new Error('apiCaller is required');

  const results = new Array(classifiedIssues.length);
  const queue = classifiedIssues.map((item, idx) => ({ item, idx }));

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      const { item, idx } = next;
      try {
        const issueText = buildIssueText(item.issue);
        const discussion = await runDiscussion({
          issueText,
          mode: item.classification.mode,
          learningContext,
          apiCaller,
          options,
        });
        results[idx] = { ...item, discussion };
      } catch (err) {
        console.error('[discussionEngine] 논의 실행 실패:', err);
        results[idx] = {
          ...item,
          discussion: {
            mode: item.classification.mode,
            error: err?.message || '알 수 없는 오류',
            opinions: [],
            moderator: { type: 'error', text: `논의 실행 실패: ${err?.message}` },
          },
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, classifiedIssues.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

// ===========================================================================
// 재논의 - 단일 이슈 모드 강제 변경 후 재실행
// ===========================================================================
/**
 * UI의 [🔄 재논의] 버튼에서 호출
 */
export async function rediscussIssue({ issue, newMode, learningContext, apiCaller, options }) {
  const issueText = buildIssueText(issue);
  return runDiscussion({
    issueText,
    mode: newMode,
    learningContext,
    apiCaller,
    options,
  });
}

// ===========================================================================
// 헬퍼
// ===========================================================================
function buildIssueText(issue) {
  if (typeof issue === 'string') return issue;
  const parts = [];
  if (issue.title) parts.push(`[제목] ${issue.title}`);
  if (issue.category) parts.push(`[카테고리] ${issue.category}`);
  if (issue.line) parts.push(`[라인] ${issue.line}`);
  if (issue.status) parts.push(`[상태] ${issue.status}`);
  if (issue.priority) parts.push(`[우선순위] ${issue.priority}`);
  if (issue.content) parts.push(`[내용]\n${issue.content}`);
  else if (issue.body) parts.push(`[내용]\n${issue.body}`);
  return parts.join('\n');
}

function extractJSON(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  try { return JSON.parse(trimmed); } catch (_) {}
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_) {}
  return null;
}

// ===========================================================================
// 기본 apiCaller 어댑터 - Anthropic SDK용 (참고 구현)
// ===========================================================================
/**
 * Anthropic SDK 클라이언트를 받아 표준 apiCaller로 래핑
 *
 * 사용 예:
 *   import Anthropic from '@anthropic-ai/sdk';
 *   const client = new Anthropic({ apiKey: ... });
 *   const apiCaller = createAnthropicCaller(client);
 *   await runDiscussion({ ..., apiCaller });
 */
export function createAnthropicCaller(client) {
  return async ({ systemPrompt, userMessage, model, maxTokens }) => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    // content 블록들을 텍스트로 결합
    return response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();
  };
}

/**
 * Netlify Function 등 fetch 기반 환경용 어댑터
 *
 * 사용 예:
 *   const apiCaller = createFetchCaller('/.netlify/functions/anthropic');
 */
export function createFetchCaller(endpoint) {
  return async ({ systemPrompt, userMessage, model, maxTokens }) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: systemPrompt, user: userMessage, model, max_tokens: maxTokens }),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    // Netlify Function이 반환하는 형식에 맞춰 조정 필요
    if (typeof data === 'string') return data;
    if (data.text) return data.text;
    if (data.content) {
      return Array.isArray(data.content)
        ? data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
        : String(data.content);
    }
    return JSON.stringify(data);
  };
}
