// ============================================================================
// ReportSection.jsx
// AZS Factory AI Agent System - 보고서 UI 컴포넌트
// ============================================================================
// 기능:
//   - 분석 요약 상단 표시 (시간/빈도 TOP 5)
//   - 모드별 이슈 섹션 (Deep / Standard / Lite)
//   - 분류 사유 표시 + 재논의 버튼
//   - 보고서 종류 선택 (일일/회의록/불량/주간)
//   - [복사] [다운로드] [이메일발송(준비중)] 버튼
//
// factory-agent-app 통합 시: import 후 <ReportSection issues={...} /> 사용
// ----------------------------------------------------------------------------

import React, { useState, useMemo } from 'react';
import { classifyIssues, MODE, groupByMode } from './reportClassifier.js';
import { runDiscussionsForIssues, rediscussIssue } from './discussionEngine.js';
import { buildAnalyticsSummary, renderAnalyticsText } from './reportAnalytics.js';

// ===========================================================================
// 보고서 종류 정의
// ===========================================================================
const REPORT_TYPES = [
  { key: 'daily',   label: '📅 일일보고서', desc: '당일 06:00~익일 06:00' },
  { key: 'meeting', label: '📝 회의록',     desc: '회의 직전 7일' },
  { key: 'defect',  label: '⚠️ 불량보고서', desc: '최근 30일' },
  { key: 'weekly',  label: '📊 주간요약',   desc: '해당 주 월~일' },
];

// ===========================================================================
// 모드별 표시 설정
// ===========================================================================
const MODE_STYLES = {
  DEEP: {
    label: '🔴 심각 이슈 (DEEP)',
    color: '#ef4444',
    bg: '#fef2f2',
    border: '#fecaca',
  },
  STANDARD: {
    label: '🟡 미완료 이슈 (STANDARD)',
    color: '#f59e0b',
    bg: '#fffbeb',
    border: '#fcd34d',
  },
  LITE: {
    label: '🟢 완료 이슈 (LITE)',
    color: '#10b981',
    bg: '#f0fdf4',
    border: '#86efac',
  },
};

// ===========================================================================
// 메인 컴포넌트
// ===========================================================================
export default function ReportSection({
  issues = [],
  apiCaller,
  learningContext = {},
  defaultReportType = 'daily',
  onError = (err) => console.error('[ReportSection]', err),
}) {
  const [reportType, setReportType] = useState(defaultReportType);
  const [phase, setPhase] = useState('idle');  // idle | classifying | discussing | done | error
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState(null);  // 최종 결과
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);

  // ─── 보고서 생성 ───
  async function handleGenerate() {
    if (!apiCaller) {
      setError('API 호출 어댑터(apiCaller)가 설정되지 않았습니다.');
      setPhase('error');
      return;
    }
    if (issues.length === 0) {
      setError('분석할 이슈가 없습니다.');
      setPhase('error');
      return;
    }

    setError(null);
    setResults(null);
    setAnalytics(null);

    try {
      // [1] 분석 요약 생성
      const summary = buildAnalyticsSummary(issues, reportType);
      setAnalytics(summary);

      const targetIssues = summary.filteredIssues;
      if (targetIssues.length === 0) {
        setPhase('done');
        setResults([]);
        return;
      }

      // [2] 분류
      setPhase('classifying');
      setProgress({ current: 0, total: targetIssues.length });
      const classified = await classifyIssues(targetIssues, apiCaller, { concurrency: 3 });

      // [3] 모드별 논의 실행
      setPhase('discussing');
      setProgress({ current: 0, total: classified.length });
      const discussed = await runDiscussionsForIssues(classified, {
        learningContext,
        apiCaller,
        concurrency: 2,
      });

      setResults(discussed);
      setPhase('done');
    } catch (err) {
      onError(err);
      setError(err?.message || String(err));
      setPhase('error');
    }
  }

  // ─── 단일 이슈 재논의 ───
  async function handleRediscuss(idx, newMode) {
    if (!results || !results[idx]) return;
    const target = results[idx];

    try {
      const newDiscussion = await rediscussIssue({
        issue: target.issue,
        newMode,
        learningContext,
        apiCaller,
      });
      const updated = [...results];
      updated[idx] = {
        ...target,
        classification: { ...target.classification, mode: newMode, reason: '사용자 재논의' },
        discussion: newDiscussion,
      };
      setResults(updated);
    } catch (err) {
      onError(err);
      alert(`재논의 실패: ${err?.message}`);
    }
  }

  // ─── 모드별 그룹핑 ───
  const grouped = useMemo(() => {
    if (!results) return null;
    return groupByMode(results);
  }, [results]);

  // ─── 보고서 텍스트 (복사/다운로드용) ───
  const reportText = useMemo(() => {
    if (!analytics || !results) return '';
    return buildReportText(reportType, analytics, grouped);
  }, [analytics, results, grouped, reportType]);

  return (
    <div style={styles.container}>
      {/* 보고서 종류 선택 */}
      <div style={styles.typeRow}>
        {REPORT_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => setReportType(t.key)}
            style={{
              ...styles.typeBtn,
              ...(reportType === t.key ? styles.typeBtnActive : {}),
            }}
          >
            <div style={styles.typeBtnLabel}>{t.label}</div>
            <div style={styles.typeBtnDesc}>{t.desc}</div>
          </button>
        ))}
      </div>

      {/* 생성 버튼 */}
      <div style={styles.controlRow}>
        <button
          onClick={handleGenerate}
          disabled={phase === 'classifying' || phase === 'discussing'}
          style={styles.generateBtn}
        >
          {phase === 'classifying' && `🔍 분류 중... (${progress.current}/${progress.total})`}
          {phase === 'discussing'  && `🗣️ 논의 중... (${progress.current}/${progress.total})`}
          {phase === 'idle'  && '📋 보고서 생성'}
          {phase === 'done'  && '🔄 다시 생성'}
          {phase === 'error' && '⚠️ 다시 시도'}
        </button>
        <span style={styles.issueCount}>대상 이슈: {issues.length}건</span>
      </div>

      {/* 에러 */}
      {phase === 'error' && (
        <div style={styles.errorBox}>⚠️ {error}</div>
      )}

      {/* 분석 요약 */}
      {analytics && <AnalyticsSummary summary={analytics} />}

      {/* 모드별 결과 */}
      {grouped && results.length > 0 && (
        <>
          {grouped.DEEP.length > 0 && (
            <ModeSection
              mode="DEEP"
              items={grouped.DEEP}
              onRediscuss={(item, newMode) => handleRediscuss(results.indexOf(item), newMode)}
            />
          )}
          {grouped.STANDARD.length > 0 && (
            <ModeSection
              mode="STANDARD"
              items={grouped.STANDARD}
              onRediscuss={(item, newMode) => handleRediscuss(results.indexOf(item), newMode)}
            />
          )}
          {grouped.LITE.length > 0 && (
            <ModeSection
              mode="LITE"
              items={grouped.LITE}
              onRediscuss={(item, newMode) => handleRediscuss(results.indexOf(item), newMode)}
            />
          )}
        </>
      )}

      {/* 빈 결과 */}
      {phase === 'done' && results && results.length === 0 && (
        <div style={styles.emptyBox}>
          📭 선택한 기간 내 이슈가 없습니다.
        </div>
      )}

      {/* 액션 버튼 */}
      {phase === 'done' && reportText && (
        <ActionButtons reportText={reportText} reportType={reportType} />
      )}
    </div>
  );
}

// ===========================================================================
// 분석 요약 박스
// ===========================================================================
function AnalyticsSummary({ summary }) {
  const maxCount = summary.timeOfDay[0]?.count || 1;
  return (
    <div style={styles.analyticsBox}>
      <div style={styles.analyticsHeader}>
        📊 이슈 분석 요약
        <span style={styles.analyticsRange}>{summary.range.label}</span>
      </div>
      <div style={styles.analyticsTotal}>총 이슈: <b>{summary.total}건</b></div>

      <div style={styles.analyticsCols}>
        {/* 시간대별 */}
        <div style={styles.analyticsCol}>
          <div style={styles.analyticsSubtitle}>⏰ 시간대별 발생 TOP 5</div>
          {summary.timeOfDay.length === 0 ? (
            <div style={styles.dim}>데이터 없음</div>
          ) : summary.timeOfDay.map((b, i) => (
            <div key={b.hour} style={styles.barRow}>
              <span style={styles.barLabel}>{i + 1}. {b.label}</span>
              <span style={styles.barFill}>
                <span style={{
                  ...styles.barInner,
                  width: `${(b.count / maxCount) * 100}%`,
                }} />
              </span>
              <span style={styles.barCount}>{b.count}건</span>
            </div>
          ))}
        </div>

        {/* 카테고리×라인 */}
        <div style={styles.analyticsCol}>
          <div style={styles.analyticsSubtitle}>🔁 발생 빈도 TOP 5 (카테고리 × 라인)</div>
          {summary.categoryLine.length === 0 ? (
            <div style={styles.dim}>데이터 없음</div>
          ) : summary.categoryLine.map((c, i) => (
            <div key={c.key} style={styles.freqRow}>
              <span style={styles.freqLabel}>{i + 1}. {c.key}</span>
              <span style={styles.freqCount}>{c.count}건</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// 모드별 섹션
// ===========================================================================
function ModeSection({ mode, items, onRediscuss }) {
  const style = MODE_STYLES[mode];
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ ...styles.modeSection, borderColor: style.border }}>
      <div
        style={{ ...styles.modeHeader, background: style.bg, color: style.color }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span>{style.label} ({items.length}건)</span>
        <span>{collapsed ? '▼' : '▲'}</span>
      </div>
      {!collapsed && items.map((item, i) => (
        <IssueCard
          key={i}
          item={item}
          mode={mode}
          onRediscuss={(newMode) => onRediscuss(item, newMode)}
        />
      ))}
    </div>
  );
}

// ===========================================================================
// 개별 이슈 카드
// ===========================================================================
function IssueCard({ item, mode, onRediscuss }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showRediscussMenu, setShowRediscussMenu] = useState(false);
  const { issue, classification, discussion } = item;

  return (
    <div style={styles.issueCard}>
      <div style={styles.issueHeader}>
        <div style={styles.issueTitle}>
          {issue.title || issue.content?.slice(0, 50) || '(제목 없음)'}
        </div>
        <div style={styles.issueMeta}>
          {issue.line && <span style={styles.metaTag}>{issue.line}</span>}
          {issue.category && <span style={styles.metaTag}>{issue.category}</span>}
          {issue.status && <span style={styles.metaTag}>{issue.status}</span>}
        </div>
      </div>

      {/* 분류 사유 */}
      <div style={styles.classifyReason}>
        📌 분류 사유: {classification.reason}
        <span style={styles.classifySource}>({classification.source})</span>
      </div>

      {/* 사회자 종합 결과 (메인 표시) */}
      <div style={styles.moderatorBox}>
        {discussion?.moderator?.text || discussion?.error || '(결과 없음)'}
      </div>

      {/* 개별 의견 펼치기 (LITE는 의견 없음) */}
      {discussion?.opinions && discussion.opinions.length > 0 && (
        <>
          <button
            onClick={() => setShowDetails(!showDetails)}
            style={styles.detailsBtn}
          >
            {showDetails ? '▲ 개별 의견 접기' : '▼ 개별 의견 펼치기'}
          </button>
          {showDetails && (
            <div style={styles.opinionsBox}>
              {discussion.router?.reason && (
                <div style={styles.routerInfo}>
                  🎯 발언 순서: {discussion.router.order.join(' → ')}
                  <span style={styles.dim}> ({discussion.router.reason})</span>
                </div>
              )}
              {discussion.opinions.map((op, i) => (
                <div key={i} style={styles.opinionRow}>
                  <div style={styles.opinionPersona}>{op.persona}</div>
                  <div style={styles.opinionText}>{op.opinion}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 재논의 버튼 */}
      <div style={styles.rediscussRow}>
        <button
          onClick={() => setShowRediscussMenu(!showRediscussMenu)}
          style={styles.rediscussBtn}
        >
          🔄 재논의
        </button>
        {showRediscussMenu && (
          <div style={styles.rediscussMenu}>
            {Object.values(MODE).filter(m => m !== mode).map(m => (
              <button
                key={m}
                onClick={() => {
                  setShowRediscussMenu(false);
                  onRediscuss(m);
                }}
                style={styles.rediscussMenuItem}
              >
                {MODE_STYLES[m].label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// 액션 버튼 (복사 / 다운로드 / 이메일)
// ===========================================================================
function ActionButtons({ reportText, reportType }) {
  const [copyStatus, setCopyStatus] = useState('');

  function handleCopy() {
    navigator.clipboard.writeText(reportText)
      .then(() => {
        setCopyStatus('✅ 복사됨');
        setTimeout(() => setCopyStatus(''), 2000);
      })
      .catch(() => setCopyStatus('❌ 복사 실패'));
  }

  function handleDownload() {
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `AZS_${reportType}_${ts}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={styles.actionRow}>
      <button onClick={handleCopy} style={styles.actionBtn}>
        📋 복사 {copyStatus}
      </button>
      <button onClick={handleDownload} style={styles.actionBtn}>
        💾 다운로드 (.txt)
      </button>
      <button disabled style={{ ...styles.actionBtn, ...styles.actionBtnDisabled }}>
        📧 이메일 발송 (준비중)
      </button>
    </div>
  );
}

// ===========================================================================
// 보고서 텍스트 생성 (복사/다운로드용)
// ===========================================================================
function buildReportText(reportType, analytics, grouped) {
  const lines = [];
  const typeLabel = REPORT_TYPES.find(t => t.key === reportType)?.label || reportType;

  lines.push('='.repeat(60));
  lines.push(`AZS Factory ${typeLabel}`);
  lines.push(`생성일: ${new Date().toLocaleString('ko-KR')}`);
  lines.push('='.repeat(60));
  lines.push('');

  lines.push(renderAnalyticsText(analytics));
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('');

  for (const mode of ['DEEP', 'STANDARD', 'LITE']) {
    if (!grouped[mode] || grouped[mode].length === 0) continue;
    lines.push(`${MODE_STYLES[mode].label} (${grouped[mode].length}건)`);
    lines.push('-'.repeat(60));

    grouped[mode].forEach((item, i) => {
      const { issue, classification, discussion } = item;
      lines.push('');
      lines.push(`[${i + 1}] ${issue.title || issue.content?.slice(0, 50) || '(제목 없음)'}`);
      if (issue.line || issue.category) {
        lines.push(`    ${[issue.line, issue.category].filter(Boolean).join(' / ')}`);
      }
      lines.push(`    분류 사유: ${classification.reason}`);
      lines.push('');
      lines.push(discussion?.moderator?.text || '(결과 없음)');
      lines.push('');
    });

    lines.push('');
  }

  return lines.join('\n');
}

// ===========================================================================
// 스타일 (factory-agent-app 디자인 토큰과 정합되도록 단순화)
// ===========================================================================
const styles = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif',
    color: '#1f2937',
    padding: '16px',
  },
  typeRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '8px',
    marginBottom: '16px',
  },
  typeBtn: {
    padding: '12px 14px',
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  typeBtnActive: {
    borderColor: '#3b82f6',
    background: '#eff6ff',
  },
  typeBtnLabel: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' },
  typeBtnDesc:  { fontSize: '11px', color: '#6b7280' },
  controlRow: {
    display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px',
  },
  generateBtn: {
    padding: '10px 18px',
    background: '#1a1a2e',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  issueCount: { fontSize: '12px', color: '#6b7280' },
  errorBox: {
    padding: '12px 16px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    color: '#991b1b',
    fontSize: '13px',
    marginBottom: '12px',
  },
  emptyBox: {
    padding: '24px', textAlign: 'center', color: '#6b7280',
    background: '#f9fafb', borderRadius: '6px', marginTop: '12px',
  },
  // 분석 요약
  analyticsBox: {
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px',
    padding: '16px', marginBottom: '16px',
  },
  analyticsHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: '15px', fontWeight: 700, marginBottom: '8px',
  },
  analyticsRange: { fontSize: '12px', color: '#6b7280', fontWeight: 400 },
  analyticsTotal: { fontSize: '13px', marginBottom: '12px', color: '#374151' },
  analyticsCols: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px',
  },
  analyticsCol: {},
  analyticsSubtitle: { fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#374151' },
  barRow: {
    display: 'grid', gridTemplateColumns: '110px 1fr 40px',
    alignItems: 'center', gap: '8px', fontSize: '12px', padding: '3px 0',
  },
  barLabel: { color: '#374151' },
  barFill: { height: '8px', background: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' },
  barInner: { display: 'block', height: '100%', background: '#3b82f6' },
  barCount: { textAlign: 'right', color: '#6b7280' },
  freqRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: '12px',
    padding: '3px 0', color: '#374151',
  },
  freqLabel: {},
  freqCount: { color: '#6b7280' },
  dim: { fontSize: '12px', color: '#9ca3af' },
  // 모드 섹션
  modeSection: {
    background: '#fff', border: '1px solid', borderRadius: '8px',
    marginBottom: '16px', overflow: 'hidden',
  },
  modeHeader: {
    padding: '12px 16px', fontSize: '14px', fontWeight: 700,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    cursor: 'pointer',
  },
  // 이슈 카드
  issueCard: {
    padding: '14px 16px', borderTop: '1px solid #f3f4f6',
  },
  issueHeader: { marginBottom: '8px' },
  issueTitle: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' },
  issueMeta: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  metaTag: {
    fontSize: '11px', padding: '2px 8px',
    background: '#f3f4f6', color: '#374151', borderRadius: '10px',
  },
  classifyReason: {
    fontSize: '11px', color: '#6b7280', marginBottom: '10px',
    padding: '6px 10px', background: '#f9fafb', borderRadius: '4px',
  },
  classifySource: { marginLeft: '6px', color: '#9ca3af' },
  moderatorBox: {
    padding: '12px 14px', background: '#f9fafb', borderRadius: '6px',
    fontSize: '13px', lineHeight: 1.7, whiteSpace: 'pre-wrap',
    color: '#1f2937',
  },
  detailsBtn: {
    marginTop: '8px', padding: '4px 10px', fontSize: '11px',
    background: 'transparent', border: '1px solid #e5e7eb',
    borderRadius: '4px', cursor: 'pointer', color: '#6b7280',
  },
  opinionsBox: {
    marginTop: '8px', padding: '12px', background: '#fff',
    border: '1px solid #e5e7eb', borderRadius: '6px',
  },
  routerInfo: { fontSize: '11px', color: '#374151', marginBottom: '10px' },
  opinionRow: {
    display: 'grid', gridTemplateColumns: '60px 1fr',
    gap: '12px', padding: '8px 0', borderTop: '1px solid #f3f4f6',
  },
  opinionPersona: { fontSize: '12px', fontWeight: 700, color: '#374151' },
  opinionText: { fontSize: '12px', color: '#1f2937', whiteSpace: 'pre-wrap', lineHeight: 1.6 },
  // 재논의
  rediscussRow: { marginTop: '10px', position: 'relative' },
  rediscussBtn: {
    padding: '4px 10px', fontSize: '11px', background: '#fff',
    border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer',
  },
  rediscussMenu: {
    position: 'absolute', top: '28px', left: 0,
    background: '#fff', border: '1px solid #e5e7eb',
    borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    zIndex: 10,
  },
  rediscussMenuItem: {
    display: 'block', width: '100%', padding: '8px 12px',
    fontSize: '12px', textAlign: 'left',
    background: 'transparent', border: 'none', cursor: 'pointer',
  },
  // 액션 버튼
  actionRow: {
    display: 'flex', gap: '8px', marginTop: '20px',
    paddingTop: '16px', borderTop: '1px solid #e5e7eb',
  },
  actionBtn: {
    padding: '8px 14px', fontSize: '13px',
    background: '#fff', border: '1px solid #d1d5db',
    borderRadius: '6px', cursor: 'pointer',
  },
  actionBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
};
