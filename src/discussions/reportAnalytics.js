// ============================================================================
// reportAnalytics.js
// AZS Factory AI Agent System - 시간별 / 빈도 TOP 5 분석
// ============================================================================
// 모든 보고서 상단에 자동 포함될 분석 데이터를 생성.
//
// 핵심 규칙:
//   - 공장 일자: 당일 06:00 ~ 익일 06:00 (자정 X, 교대 시작 기준)
//   - 빈도 그룹핑: 카테고리 + 라인 분리 (예: "BM Downtime - Cell" / "BM Downtime - Elec")
//   - 시간 데이터 소스: 기본 updated_at, 폴백 본문 추출 (AI 추출은 호출자 책임)
// ----------------------------------------------------------------------------

// ===========================================================================
// 공장 일자 처리 - 06:00 기준
// ===========================================================================
const FACTORY_DAY_START_HOUR = 6;

/**
 * Date 객체를 받아 "공장 일자" Date 객체로 변환
 * - 06:00 이전 시각은 전날의 공장 일자에 속함
 * - 반환값은 해당 공장 일자의 06:00 시점
 *
 * 예시:
 *   2026-04-25 14:30 → 2026-04-25 06:00
 *   2026-04-25 03:30 → 2026-04-24 06:00 (아직 24일 야간조 시간)
 */
export function toFactoryDay(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;

  const result = new Date(d);
  if (d.getHours() < FACTORY_DAY_START_HOUR) {
    result.setDate(result.getDate() - 1);
  }
  result.setHours(FACTORY_DAY_START_HOUR, 0, 0, 0);
  return result;
}

/**
 * 공장 일자 범위 [start, end) 생성
 * @param {Date} factoryDay - 공장 일자 시작 (06:00)
 * @returns {{start: Date, end: Date}}
 */
export function factoryDayRange(factoryDay) {
  const start = toFactoryDay(factoryDay);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * 공장 일자를 "YYYY-MM-DD" 문자열로
 */
export function factoryDayToString(factoryDay) {
  const d = toFactoryDay(factoryDay);
  if (!d) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ===========================================================================
// 보고서 종류별 분석 범위 계산
// ===========================================================================
/**
 * @param {string} reportType - 'daily' | 'meeting' | 'defect' | 'weekly'
 * @param {Date} referenceDate - 기준일 (보통 오늘)
 * @returns {{start: Date, end: Date, label: string}}
 */
export function getAnalysisRange(reportType, referenceDate = new Date()) {
  const ref = new Date(referenceDate);

  switch (reportType) {
    case 'daily': {
      // 당일 06:00 ~ 익일 06:00
      const range = factoryDayRange(ref);
      return { ...range, label: `${factoryDayToString(range.start)} (06:00~익일06:00)` };
    }

    case 'meeting': {
      // 회의 직전 7일
      const end = toFactoryDay(ref);
      const endNext = new Date(end);
      endNext.setDate(endNext.getDate() + 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);  // 7일 포함
      return {
        start, end: endNext,
        label: `${factoryDayToString(start)} ~ ${factoryDayToString(end)} (7일)`,
      };
    }

    case 'defect': {
      // 최근 30일
      const end = toFactoryDay(ref);
      const endNext = new Date(end);
      endNext.setDate(endNext.getDate() + 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 29);  // 30일 포함
      return {
        start, end: endNext,
        label: `${factoryDayToString(start)} ~ ${factoryDayToString(end)} (30일)`,
      };
    }

    case 'weekly': {
      // 해당 주 월요일 06:00 ~ 차주 월요일 06:00
      const today = toFactoryDay(ref);
      // 월요일 = getDay() 1, 일요일 = 0
      const dayOfWeek = today.getDay();
      const daysFromMonday = (dayOfWeek + 6) % 7;  // 월=0, 화=1, ..., 일=6
      const monday = new Date(today);
      monday.setDate(monday.getDate() - daysFromMonday);
      const nextMonday = new Date(monday);
      nextMonday.setDate(nextMonday.getDate() + 7);
      return {
        start: monday, end: nextMonday,
        label: `${factoryDayToString(monday)} 주차`,
      };
    }

    default:
      throw new Error(`Unknown reportType: ${reportType}`);
  }
}

// ===========================================================================
// 이슈 시간 추출 (updated_at 우선, 폴백은 호출자 처리)
// ===========================================================================
/**
 * 이슈에서 발생 시각 Date 객체 추출
 * @param {object} issue
 * @returns {Date|null}
 */
export function extractIssueTime(issue) {
  // 우선순위: occurred_at > updated_at > created_at > timestamp
  const candidates = [
    issue.occurred_at,
    issue.updated_at,
    issue.created_at,
    issue.timestamp,
    issue.time,
    issue.date,
  ];

  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

/**
 * 이슈 배열을 분석 범위로 필터링
 */
export function filterIssuesByRange(issues, range) {
  return issues.filter(issue => {
    const t = extractIssueTime(issue);
    if (!t) return false;
    return t >= range.start && t < range.end;
  });
}

// ===========================================================================
// 시간대별 발생 TOP 5 (시간 = 0~23시)
// ===========================================================================
/**
 * @param {Array<object>} issues
 * @param {number} topN - 기본 5
 * @returns {Array<{hour: number, label: string, count: number}>}
 */
export function timeOfDayTop(issues, topN = 5) {
  const buckets = new Array(24).fill(0);

  for (const issue of issues) {
    const t = extractIssueTime(issue);
    if (!t) continue;
    buckets[t.getHours()]++;
  }

  const ranked = buckets
    .map((count, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00~${String((hour + 1) % 24).padStart(2, '0')}:00`,
      count,
    }))
    .filter(b => b.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  return ranked;
}

// ===========================================================================
// 빈도 TOP 5 (카테고리 × 라인)
// ===========================================================================
/**
 * "카테고리 - 라인" 키로 그룹핑
 * 라인이 없으면 "공통"
 * 카테고리가 없으면 "미분류"
 */
export function categoryLineTop(issues, topN = 5) {
  const counter = new Map();

  for (const issue of issues) {
    const category = (issue.category || '미분류').trim();
    const line = (issue.line || '공통').trim();
    const key = `${category} - ${line}`;
    counter.set(key, (counter.get(key) || 0) + 1);
  }

  return Array.from(counter.entries())
    .map(([key, count]) => {
      const [category, line] = key.split(' - ');
      return { key, category, line, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

// ===========================================================================
// 통합 분석 - 보고서 상단용 Summary 객체 생성
// ===========================================================================
/**
 * @param {Array<object>} issues - 전체 이슈
 * @param {string} reportType - 'daily' | 'meeting' | 'defect' | 'weekly'
 * @param {Date} referenceDate
 * @returns {{
 *   range: {start, end, label},
 *   total: number,
 *   timeOfDay: Array<{hour, label, count}>,
 *   categoryLine: Array<{key, category, line, count}>,
 * }}
 */
export function buildAnalyticsSummary(issues, reportType, referenceDate = new Date()) {
  const range = getAnalysisRange(reportType, referenceDate);
  const filtered = filterIssuesByRange(issues, range);

  return {
    range,
    total: filtered.length,
    timeOfDay: timeOfDayTop(filtered, 5),
    categoryLine: categoryLineTop(filtered, 5),
    filteredIssues: filtered,  // 후속 모드 분류 단계에서 재사용
  };
}

// ===========================================================================
// 텍스트 렌더링 - 보고서 상단 출력용 문자열
// ===========================================================================
/**
 * 막대 차트(텍스트) 생성
 */
function renderBar(count, max, width = 8) {
  if (max === 0) return '';
  const filled = Math.round((count / max) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

/**
 * Summary → 보고서 상단 텍스트
 */
export function renderAnalyticsText(summary) {
  const lines = [];
  lines.push('📊 이슈 분석 요약');
  lines.push(`📅 범위: ${summary.range.label}`);
  lines.push(`📌 총 이슈: ${summary.total}건`);
  lines.push('');

  // 시간대별 TOP 5
  if (summary.timeOfDay.length > 0) {
    lines.push('⏰ 시간대별 발생 TOP 5');
    const max = summary.timeOfDay[0].count;
    summary.timeOfDay.forEach((b, i) => {
      const bar = renderBar(b.count, max);
      lines.push(`${i + 1}. ${b.label}  ${bar}  ${b.count}건`);
    });
    lines.push('');
  } else {
    lines.push('⏰ 시간대별 발생: 데이터 없음');
    lines.push('');
  }

  // 카테고리 × 라인 TOP 5
  if (summary.categoryLine.length > 0) {
    lines.push('🔁 발생 빈도 TOP 5 (카테고리 × 라인)');
    summary.categoryLine.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.key.padEnd(28, ' ')} ${c.count}건`);
    });
  } else {
    lines.push('🔁 발생 빈도: 데이터 없음');
  }

  return lines.join('\n');
}

// ===========================================================================
// 반복 이슈 감지 - 분류기의 "반복 언급" 기준 보조
// ===========================================================================
/**
 * 같은 카테고리×라인이 N회 이상 발생했는지 체크
 * → reportClassifier.js의 STEP 3에서 컨텍스트로 활용 가능
 *
 * @returns {Set<string>} 반복 발생한 "카테고리 - 라인" 키들
 */
export function findRecurringKeys(issues, threshold = 3) {
  const counter = new Map();
  for (const issue of issues) {
    const category = (issue.category || '미분류').trim();
    const line = (issue.line || '공통').trim();
    const key = `${category} - ${line}`;
    counter.set(key, (counter.get(key) || 0) + 1);
  }

  const recurring = new Set();
  for (const [key, count] of counter.entries()) {
    if (count >= threshold) recurring.add(key);
  }
  return recurring;
}
