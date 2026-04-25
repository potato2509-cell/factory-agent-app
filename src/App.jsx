import { useState, useRef, useEffect } from "react";

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE9ZyopUTxEEXpt3UjWjfgDljEiGodgbunj_UnXYc-1RlrXgNiDzAiikXoEP4g9_E/exec";
const MAX_ISSUES = 10;

// ─── 보고서 종류 ───────────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { id:"daily",   icon:"📋", label:"일일 생산 보고서",  desc:"당일 생산 실적·이슈·KPI 요약" },
  { id:"meeting", icon:"🗂️", label:"회의록",           desc:"논의 내용·결정사항·액션아이템" },
  { id:"defect",  icon:"⚠️", label:"불량/이슈 보고서", desc:"불량 내역·원인분석·대책 수립" },
  { id:"weekly",  icon:"📊", label:"주간 요약 보고서",  desc:"주간 트렌드·KPI·개선 과제" },
];

const REPORT_FOCUS = {
  daily:   "당일 생산 실적과 이슈 전반을 검토하고 내일 계획을 수립하는 관점으로",
  meeting: "결정사항과 액션아이템 도출에 집중하는 관점으로",
  defect:  "불량 원인 파악·4M 분석·재발 방지 대책 수립에 집중하는 관점으로",
  weekly:  "주간 트렌드·KPI 달성 현황·개선 과제 도출에 집중하는 관점으로",
};

// ─── 키워드 화이트리스트 (즉시 DEEP 강제) ───────────────────────────────────────
const DEEP_FORCE_KEYWORDS = {
  안전: ["부상", "사고", "화재", "감전", "추락", "응급", "구급", "injury", "fire"],
  환경: ["누유", "누수", "유출", "분진", "악취", "leak", "spill"],
  품질통제: ["SAR", "NCR", "HOLD", "Special Action Request", "Non-Conformance"],
  출하고객: ["고객 클레임", "반품", "출하 정지", "납품 지연", "claim"],
  라인정지: ["라인 정지", "가동 중단", "전 라인 멈춤", "올스톱", "full_stop"],
};

// ─── 모델 설정 (Function이 model 파라미터 지원하도록 수정됨) ─────────────────────
const MODEL_FAST = "claude-haiku-4-5";       // 라우터/분류기
const MODEL_REASONING = "claude-sonnet-4-5"; // 본 논의/사회자

// ─── 페르소나 정의 (5종) ────────────────────────────────────────────────────────
const PERSONAS = {
  Cell_PE: {
    label: "생산 엔지니어",
    color: "#3b82f6", bg: "rgba(59,130,246,0.12)", icon: "🔵",
    role: "PE (Production Engineer)",
    priority: "생산목표 달성(무리한 가동 지양) → 작업자 안전 → SOP → 납기",
    focus: "일일/주간 생산목표, 가동률, 작업자 숙련도, SOP, 자재 공급",
    stance: "TE의 임시조치/근본조치 요구에 적극 협조 (가동정지 감수 가능). ME 정비 시간과 일정 조율. 안전·품질 앞에서는 가동 고집 금지.",
  },
  Cell_ME: {
    label: "설비 엔지니어",
    color: "#f97316", bg: "rgba(249,115,22,0.12)", icon: "🟠",
    role: "ME (Maintenance Engineer)",
    priority: "설비 신뢰성(MTBF·MTTR) → 예지보전 → 설비 수명 → 정비비용",
    focus: "BM 빈도/패턴, 설비 노후도, 부품 수명, 진동·온도·소음, 예비부품",
    stance: "TE 원인 분석에 설비 데이터/이력으로 적극 협력. PE 가동요구 시 설비 부하 한계 명시.",
  },
  Cell_TE: {
    label: "기술 엔지니어 ★",
    color: "#22d3ee", bg: "rgba(34,211,238,0.12)", icon: "🟢",
    role: "TE (Technical Engineer) — 근본원인 규명 주도자",
    priority: "수율 개선(가장 중요) → 불량 발생 공정 신속 규명 → RCA 임시/항구 대책 → Cpk 안정화",
    focus: "불량 패턴, 공정 변수(온도·압력·속도), 수율 추이, Cpk, 유사 불량 이력",
    stance: "이슈 발생 시 ① 어느 공정에서 발생했는지 진단 ② 임시조치/근본조치 구분 제시 ③ 데이터 근거 제시. PE/ME는 TE 진단을 우선 검토.",
  },
  Cell_FA: {
    label: "FA 엔지니어",
    color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "🟣",
    role: "FA (Factory Automation) Engineer — 자동 반송 시스템",
    priority: "반송 흐름 안정성 → 반송 설비 가동률 → WIP 적정 수준 → MES/PLC 연동",
    focus: "C/V 잼·정렬, Stocker 처리능력, OHT 충돌·경로, AGV 배터리·통신, MES 통신, WIP 누적, 반송 중 손상",
    stance: "이슈가 공정인가 반송인가 검토. TE 분석 시 반송 중 발생 가능성(낙하·충격·대기) 제시.",
  },
  Cell_Vision: {
    label: "Vision 엔지니어",
    color: "#ec4899", bg: "rgba(236,72,153,0.12)", icon: "🔴",
    role: "Vision Engineer — 외관검사",
    priority: "외관 불량 검출 정확도 → Vision 시스템 안정성 → 알고리즘 최적화 → 신규 불량 모드 학습",
    focus: "검사 통과율, 오검/미검률, 조명·카메라 컨디션, 신규 불량 패턴, 검사 기준",
    stance: "검출 정확도 관점에서 의견. 오검·미검 가능성, 신규 불량 모드 여부 검토.",
  },
};

// 공장 운영 철학 (모든 페르소나 공통)
const FACTORY_PHILOSOPHY = `
[공장 운영 철학 - 절대 원칙]
현재 공장은 최대 CAPA 대비 생산량이 부족한 상태입니다.
"생산 목표만 달성 가능한 수준"이라면 굳이 불량을 감수하며 가동할 이유가 없습니다.
→ 품질·근본조치 우선, 무리한 가동 지양이 운영 철학입니다.
`.trim();

// ─── Google Sheets ─────────────────────────────────────────────────────────────
async function saveToSheets(data) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST", mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_minutes", ...data }),
    });
    return true;
  } catch { return false; }
}

async function loadKnowledge(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_knowledge&role=${role}`);
    const data = await res.json();
    return data.success ? data.data.map(k => `[${k.category}] ${k.content}`).join("\n") : "";
  } catch { return ""; }
}

async function loadAllKnowledge() {
  // ★ 5개 페르소나 모두 로드
  const roles = ["Cell_PE", "Cell_ME", "Cell_TE", "Cell_FA", "Cell_Vision"];
  const results = await Promise.allSettled(roles.map(r => loadKnowledge(r)));
  const kb = {};
  const stats = { failed: 0 };
  roles.forEach((role, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      kb[role] = r.value;
      stats[role] = r.value ? r.value.split("\n").filter(Boolean).length : 0;
    } else {
      kb[role] = "";
      stats[role] = 0;
      stats.failed++;
    }
  });
  return { kb, stats };
}

// ─── Claude API ────────────────────────────────────────────────────────────────
// ★ model 파라미터 추가
async function callClaudeRaw(system, userMsg, opts = {}) {
  const { model = MODEL_REASONING, max_tokens = 1000 } = opts;
  let res;
  try {
    res = await fetch("/.netlify/functions/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, userMsg, max_tokens, model }),
    });
  } catch (e) { throw new Error(`네트워크 오류: ${e.message}`); }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 100)}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(`API 오류: ${data.error}`);
  return (data.content || []).map(i => i.text || "").join("").trim();
}

function safeJSON(raw) {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("JSON 없음");
  let jsonStr = cleaned.slice(s, e + 1);
  try { return JSON.parse(jsonStr); }
  catch {
    jsonStr = jsonStr.replace(/,\s*"[^"]*$/, "").replace(/,\s*\{[^}]*$/, "");
    let ob = 0, cb = 0, oq = 0, cq = 0;
    for (const c of jsonStr) {
      if (c==="{") ob++; if (c==="}") cb++;
      if (c==="[") oq++; if (c==="]") cq++;
    }
    for (let i=0; i<oq-cq; i++) jsonStr += "]";
    for (let i=0; i<ob-cb; i++) jsonStr += "}";
    return JSON.parse(jsonStr);
  }
}

// ─── WhatsApp 파서 (기존 그대로) ───────────────────────────────────────────────
function parseWhatsApp(text) {
  const lines = text.split("\n");
  const msgRe = /^(\d{2}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+-\s+([^:]+):\s*(.*)/;
  const msgs = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(msgRe);
    if (m) {
      if (cur) msgs.push(cur);
      cur = { date: m[1], time: m[2], hour: parseInt(m[2].split(":")[0]), sender: m[3].trim(), text: m[4] };
    } else if (cur && line.trim()) {
      cur.text += "\n" + line;
    }
  }
  if (cur) msgs.push(cur);
  return msgs.filter(m =>
    !m.text.includes("미디어 파일 제외됨") &&
    !m.text.includes("메시지와 통화는 종단간") &&
    !m.text.includes("그룹 만든이가") &&
    !m.text.includes("그룹에 추가되었습니다") &&
    !m.text.includes("이 메시지는 삭제되었습니다")
  );
}

function getProductionDate(date, hour) {
  if (hour < 6) {
    const parts = date.split("/").map(Number);
    const d = new Date(2000 + parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 1);
    const yy = String(d.getFullYear()).slice(-2);
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    return `${yy}/${mm}/${dd}`;
  }
  return date;
}

function getWeekDates(dateStr) {
  const parts = dateStr.split("/").map(Number);
  const d = new Date(2000 + parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    const yy = String(cur.getFullYear()).slice(-2);
    const mm = cur.getMonth() + 1;
    const dd = cur.getDate();
    dates.push(`${yy}/${mm}/${dd}`);
  }
  return dates;
}

function getUniqueDates(msgs) {
  const prodDates = msgs.map(m => getProductionDate(m.date, m.hour));
  return [...new Set(prodDates)].sort((a, b) => {
    const pa = a.split("/").map(Number);
    const pb = b.split("/").map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
}

function filterByDates(msgs, dates) {
  return msgs.filter(m => dates.includes(getProductionDate(m.date, m.hour)));
}

// ─── 이슈 파싱 (기존 그대로) ────────────────────────────────────────────────────
function extractField(text, fieldName) {
  const re = new RegExp(`\\*?${fieldName}\\*?[:\\s]+\\*?\\n?-?\\s*([^\\n]+)`, "i");
  return text.match(re)?.[1]?.replace(/\*/g, "").trim() || "";
}

function classifyMessages(msgs) {
  const downtime = [], equipment = [], general = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m.text.includes("[BM Downtime Bot]")) {
      let full = m.text;
      let j = i + 1;
      while (j < msgs.length && !msgs[j].text.includes("[BM Downtime Bot]")) {
        if (!msgs[j].text.includes("미디어 파일 제외됨")) full += "\n" + msgs[j].text;
        j++;
        if (j - i > 15) break;
      }
      downtime.push({ time: m.time, text: full, date: m.date, hour: m.hour });
      i = j;
    } else if (m.text.match(/cutter|limit|⚠️|🟡|cathode|anode/i)) {
      equipment.push({ time: m.time, sender: m.sender, text: m.text, date: m.date, hour: m.hour });
      i++;
    } else {
      if (m.text.trim().length > 5) general.push({ time: m.time, sender: m.sender, text: m.text, date: m.date, hour: m.hour });
      i++;
    }
  }
  return { downtime, equipment, general };
}

function classifyPriority(downtime) {
  const equipCount = {}, partCount = {};
  downtime.forEach(d => {
    const eq = extractField(d.text, "Equipment");
    const part = extractField(d.text, "Part Replacement");
    if (eq) equipCount[eq] = (equipCount[eq] || 0) + 1;
    if (part && part !== "-" && part.length > 2) partCount[part] = (partCount[part] || 0) + 1;
  });

  const urgent = [], important = [], normal = [];
  downtime.forEach(d => {
    const result = extractField(d.text, "Result").toLowerCase();
    const durStr = extractField(d.text, "Duration");
    const durMin = parseInt(durStr) || 0;
    const stopStatus = extractField(d.text, "Stop Status").toLowerCase();
    const eq = extractField(d.text, "Equipment");
    const part = extractField(d.text, "Part Replacement");

    const isUnsolved = result.includes("not solved") || result.includes("unsolved") || result === "";
    const isLong = durMin >= 60;
    const isRepeat = eq && equipCount[eq] >= 2;
    const isFullStop = stopStatus.includes("full_stop");
    const isRepeatPart = part && part !== "-" && part.length > 2 && partCount[part] >= 2;

    const eq_ = extractField(d.text, "Equipment");
    const prob = extractField(d.text, "Problem");
    const cause = extractField(d.text, "Cause");
    const result_ = extractField(d.text, "Result");
    const pic = extractField(d.text, "PIC");
    const issueInfo = { ...d, eq: eq_, prob, cause, result: result_, pic, durMin, reasons: [] };

    if (isUnsolved || isLong) {
      issueInfo.reasons = [isUnsolved && "미해결", isLong && `${durMin}분 이상`].filter(Boolean);
      urgent.push(issueInfo);
    } else if (isRepeat || isFullStop || isRepeatPart) {
      issueInfo.reasons = [isRepeat && "반복 고장", isFullStop && "완전 정지", isRepeatPart && "부품 반복 교체"].filter(Boolean);
      important.push(issueInfo);
    } else {
      normal.push(issueInfo);
    }
  });
  return { urgent, important, normal };
}

function selectKeyIssues(priority) {
  const all = [...priority.urgent, ...priority.important];
  return all.slice(0, MAX_ISSUES);
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ 새로운 논의 시스템 ★
// ═════════════════════════════════════════════════════════════════════════════

// ─── 1. 모드 분류 (키워드 → 우선순위 → 폴백) ───────────────────────────────────
function classifyDiscussionMode(issue, isPriUrgent, isPriImportant) {
  const fullText = [issue.eq, issue.prob, issue.cause, issue.result, issue.text].join(" ");

  // STEP 1: 키워드 강제 체크
  for (const [category, keywords] of Object.entries(DEEP_FORCE_KEYWORDS)) {
    for (const kw of keywords) {
      if (fullText.toLowerCase().includes(kw.toLowerCase())) {
        return {
          mode: "DEEP",
          reason: `[${category}] 키워드 감지: "${kw}"`,
          source: "keyword",
        };
      }
    }
  }

  // STEP 2: 기존 우선순위 매핑
  if (isPriUrgent) {
    return { mode: "DEEP", reason: `긴급 이슈 (${issue.reasons?.join(", ")})`, source: "priority" };
  }
  if (isPriImportant) {
    return { mode: "STANDARD", reason: `중요 이슈 (${issue.reasons?.join(", ")})`, source: "priority" };
  }

  // STEP 3: 일반 → LITE
  return { mode: "LITE", reason: "일반 이슈 (완료/단순)", source: "default" };
}

// ─── 2. 라우터: 발언 순서 결정 (AI 호출 1회, Haiku) ────────────────────────────
async function routeAgentOrder(issueCtx) {
  const sys = `당신은 공장 이슈 논의의 발언 순서를 결정하는 라우터입니다.

[참여 가능 페르소나]
- Cell_PE: 생산 (생산목표/가동률/SOP)
- Cell_ME: 설비 (BM/MTBF/정비)
- Cell_TE: 기술 (불량/RCA/공정변수/수율) — 불량·품질 이슈는 항상 첫 발언자
- Cell_FA: 자동 반송 (C/V·Stocker·OHT·AGV·MES)
- Cell_Vision: 외관검사 (검출률·오검·미검)

[규칙]
1. 불량·품질·수율 → Cell_TE 첫 발언
2. 설비 BM·정지 → Cell_ME 첫 발언
3. 생산목표·가동률 → Cell_PE 첫 발언
4. 반송·MES·WIP → Cell_FA 포함
5. 외관·검사 → Cell_Vision 포함
6. 기본 PE/ME/TE 3명. FA/Vision은 명확히 관련될 때만 추가
7. 최소 3명, 최대 5명

JSON만 출력 (다른 텍스트 금지):
{"order":["Cell_TE","Cell_ME","Cell_PE"],"reason":"불량 이슈로 TE 우선"}`;

  try {
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n발언 순서 결정.`, {
      model: MODEL_FAST,
      max_tokens: 150,
    });
    const parsed = safeJSON(raw);
    let order = Array.isArray(parsed.order) ? parsed.order : [];
    order = order.filter(p => PERSONAS[p]);
    if (order.length < 3) {
      // 폴백: 기본 PE/ME/TE
      const fallback = ["Cell_TE", "Cell_ME", "Cell_PE"];
      for (const f of fallback) if (!order.includes(f)) order.push(f);
      order = order.slice(0, 5);
    }
    return { order, reason: parsed.reason || "라우터 판단", source: "router" };
  } catch {
    return {
      order: ["Cell_TE", "Cell_ME", "Cell_PE"],
      reason: "라우터 실패 - 기본 순서",
      source: "fallback",
    };
  }
}

// ─── 3. 단일 페르소나 호출 (이전 의견 누적) ────────────────────────────────────
async function callPersona(personaCode, issueCtx, prevOpinions, kbText, reportType) {
  const p = PERSONAS[personaCode];
  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const kb = kbText ? `\n\n[학습 내용]\n${kbText.slice(0, 500)}` : "";

  const prevText = prevOpinions.length > 0
    ? `\n\n[먼저 발언한 동료 의견]\n${prevOpinions.map(o => `── ${PERSONAS[o.persona]?.label} (${o.persona}) ──\n${o.opinion}`).join("\n\n")}\n\n위 의견을 참고하여 의견을 제시하세요. 동의할 부분은 "동의합니다"로 짧게, 다른 입장일 때만 명확히 다른 관점 제시.`
    : "\n\n당신의 관점에서 의견을 제시하세요.";

  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장 Cell 라인 ${p.role}입니다.

[우선순위] ${p.priority}
[관심 영역] ${p.focus}
[입장] ${p.stance}${kb}

${focus} 다음 이슈를 분석하세요.

JSON만 출력:
{"analysis":"이슈 원인 및 영향 분석 (100자이내)","action":"즉시 조치사항 (60자이내)","prevention":"재발방지 방안 (60자이내)"}`;

  try {
    await new Promise(r => setTimeout(r, 600));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}${prevText}`, {
      model: MODEL_REASONING,
      max_tokens: 500,
    });
    return safeJSON(raw);
  } catch {
    return { analysis: "분석 중 오류", action: "-", prevention: "-" };
  }
}

// ─── 4. 사회자: DEEP 5섹션 ─────────────────────────────────────────────────────
async function moderateDeep(issueCtx, opinions) {
  const opinionsText = opinions.map(o => {
    const p = PERSONAS[o.persona];
    return `── ${p.label} (${o.persona}) ──\n분석: ${o.opinion?.analysis}\n조치: ${o.opinion?.action}\n재발방지: ${o.opinion?.prevention}`;
  }).join("\n\n");

  const sys = `당신은 공장 이슈 논의의 중립 사회자입니다. 어느 한쪽 편들지 않고 객관적으로 종합하세요.
공장 운영 철학: 품질·근본조치 우선, 무리한 가동 지양.

JSON만 출력:
{
  "consensus":"합의된 사항 (모두 동의하는 부분만, 없으면 '명확한 합의점 없음')",
  "differences":"관점별 차이 한 줄씩 (참여한 페르소나만)",
  "conflicts":"핵심 충돌 지점 1-3개",
  "recommendation":"권고 결론 (단기 조치 / 장기 조치 / 우선순위)",
  "needsMore":"추가 논의 필요 사항 (없으면 '없음')"
}`;

  try {
    await new Promise(r => setTimeout(r, 500));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n[엔지니어 의견]\n${opinionsText}\n\n5섹션 형식으로 종합 정리하세요.`, {
      model: MODEL_REASONING,
      max_tokens: 800,
    });
    return safeJSON(raw);
  } catch {
    return {
      consensus: "사회자 종합 실패",
      differences: "-", conflicts: "-", recommendation: "-", needsMore: "-",
    };
  }
}

// ─── 5. 사회자: STANDARD 액션플랜 ──────────────────────────────────────────────
async function moderateStandard(issueCtx, opinions) {
  const opinionsText = opinions.map(o => {
    const p = PERSONAS[o.persona];
    return `── ${p.label} (${o.persona}) ──\n조치: ${o.opinion?.action}\n재발방지: ${o.opinion?.prevention}`;
  }).join("\n\n");

  const sys = `당신은 공장 이슈 논의의 중립 사회자입니다. 의견을 받아 실행 가능한 액션 플랜으로 정리하세요.
의견 백화점 금지, 추상 표현 금지, 담당과 우선순위 명확히.

JSON만 출력:
{
  "summary":"한 줄 핵심 요약",
  "actions":[
    {"action":"구체적 행동 (60자이내)","owner":"Cell_PE/ME/TE 등","priority":"긴급/중간/낮음","duration":"예: 4h, 2일"}
  ],
  "needsMore":"추가 확인 필요 (없으면 '없음')"
}`;

  try {
    await new Promise(r => setTimeout(r, 500));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n[의견]\n${opinionsText}\n\n액션 플랜으로 정리.`, {
      model: MODEL_REASONING,
      max_tokens: 700,
    });
    return safeJSON(raw);
  } catch {
    return { summary: "사회자 종합 실패", actions: [], needsMore: "-" };
  }
}

// ─── 6. 사회자: LITE 압축 평가 (단독 호출, 페르소나 호출 없음) ──────────────────
async function moderateLite(issueCtx) {
  const sys = `당신은 공장 이슈 논의의 중립 사회자입니다.
이미 완료된 이슈에 대해 PE/ME/TE 관점을 종합한 짧은 평가를 작성하세요.

JSON만 출력:
{
  "supplement":"보완점 (놓친 부분, 1줄)",
  "recurRisk":"재발 우려 (있음/낮음 + 1줄 근거)",
  "prevention":"재발 방지책 (1-2개 구체 행동)"
}`;

  try {
    await new Promise(r => setTimeout(r, 400));
    const raw = await callClaudeRaw(sys, `[완료된 이슈]\n${issueCtx}\n\n짧게 평가.`, {
      model: MODEL_REASONING,
      max_tokens: 400,
    });
    return safeJSON(raw);
  } catch {
    return { supplement: "-", recurRisk: "-", prevention: "-" };
  }
}

// ─── 7. 통합: 단일 이슈 모드별 논의 실행 ────────────────────────────────────────
async function runIssueDiscussion(issue, modeInfo, kb, reportType, onProgress) {
  const issueCtx = `설비: ${issue.eq}
발생시간: ${issue.time}
다운타임: ${issue.durMin}분
문제: ${issue.prob}
원인: ${issue.cause}
결과: ${issue.result}
담당자: ${issue.pic}
우선순위 사유: ${issue.reasons?.join(", ")}`;

  // ─── LITE 모드: 사회자만 단독 호출 (1회) ───
  if (modeInfo.mode === "LITE") {
    onProgress?.(`🟢 LITE 모드 - 사회자 단독 평가`);
    const result = await moderateLite(issueCtx);
    return {
      issue, modeInfo,
      router: null,
      opinions: [],
      moderator: { type: "lite", ...result },
    };
  }

  // ─── DEEP / STANDARD: 라우터 → 순차 호출 → 사회자 ───
  // [1] 라우터
  onProgress?.(`🎯 라우터: 발언 순서 결정 중...`);
  const router = await routeAgentOrder(issueCtx);
  onProgress?.(`🎯 발언 순서: ${router.order.map(o => PERSONAS[o]?.label).join(" → ")}`);

  // [2] 페르소나 순차 호출
  const opinions = [];
  for (const personaCode of router.order) {
    const p = PERSONAS[personaCode];
    onProgress?.(`${p.icon} ${p.label} 의견 수렴 중... (${opinions.length + 1}/${router.order.length})`);
    const opinion = await callPersona(personaCode, issueCtx, opinions, kb[personaCode] || "", reportType);
    opinions.push({ persona: personaCode, opinion });
  }

  // [3] 사회자 (모드별 분기)
  onProgress?.(`📋 사회자 종합 중...`);
  const moderator = modeInfo.mode === "DEEP"
    ? { type: "deep", ...await moderateDeep(issueCtx, opinions) }
    : { type: "standard", ...await moderateStandard(issueCtx, opinions) };

  return { issue, modeInfo, router, opinions, moderator };
}

// ═════════════════════════════════════════════════════════════════════════════
// 시간/빈도 분석 (인수인계 문서 7번)
// ═════════════════════════════════════════════════════════════════════════════
function buildTimeFreqAnalysis(allIssues) {
  // 시간대별
  const hourBuckets = new Array(24).fill(0);
  for (const issue of allIssues) {
    const h = parseInt(String(issue.time).split(":")[0]);
    if (!isNaN(h)) hourBuckets[h]++;
  }
  const timeOfDay = hourBuckets
    .map((count, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00~${String((hour + 1) % 24).padStart(2, "0")}:00`,
      count,
    }))
    .filter(b => b.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 카테고리(설비) × 라인 — Cell 라인 단일이므로 설비별 빈도
  const eqCounter = new Map();
  for (const issue of allIssues) {
    const eq = (issue.eq || "미분류").trim();
    eqCounter.set(eq, (eqCounter.get(eq) || 0) + 1);
  }
  const categoryFreq = Array.from(eqCounter.entries())
    .map(([eq, count]) => ({ key: `${eq} - Cell`, eq, line: "Cell", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { timeOfDay, categoryFreq, total: allIssues.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// 보고서 생성 (모드별 그룹핑 + 시간/빈도 분석 추가)
// ═════════════════════════════════════════════════════════════════════════════
async function generateReport(date, dates, discussions, priority, reportType, kb, allIssues) {
  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const reportTitle = REPORT_TYPES.find(r => r.id === reportType)?.label || "회의록";
  const dateStr = dates.length > 1 ? `${dates[0]} ~ ${dates[dates.length-1]}` : date;

  // 시간/빈도 분석 (모든 이슈 대상)
  const analytics = buildTimeFreqAnalysis(allIssues);

  // 모드별 그룹핑
  const grouped = { DEEP: [], STANDARD: [], LITE: [] };
  for (const d of discussions) {
    grouped[d.modeInfo.mode]?.push(d);
  }

  // 논의 결과 요약 (사회자 출력 위주)
  const discussionSummary = discussions.map((d, i) => {
    const m = d.moderator;
    if (m.type === "deep") {
      return `[이슈${i+1}-DEEP] ${d.issue.eq} (${d.issue.durMin}분)
합의: ${m.consensus} | 충돌: ${m.conflicts} | 권고: ${m.recommendation}`;
    }
    if (m.type === "standard") {
      return `[이슈${i+1}-STANDARD] ${d.issue.eq} (${d.issue.durMin}분)
요약: ${m.summary} | 액션: ${(m.actions || []).map(a => `${a.owner}-${a.action}`).join(", ")}`;
    }
    return `[이슈${i+1}-LITE] ${d.issue.eq}: ${m.supplement} / 재발: ${m.recurRisk}`;
  }).join("\n\n");

  const ctx = `날짜: ${dateStr}
보고서 종류: ${reportTitle}
긴급: ${priority.urgent.length}건 / 중요: ${priority.important.length}건 / 일반: ${priority.normal.length}건
모드별 분석: DEEP ${grouped.DEEP.length} / STANDARD ${grouped.STANDARD.length} / LITE ${grouped.LITE.length}

[시간대별 발생 TOP 5]
${analytics.timeOfDay.map((t, i) => `${i+1}. ${t.label} ${t.count}건`).join("\n")}

[빈도 TOP 5 (설비×라인)]
${analytics.categoryFreq.map((c, i) => `${i+1}. ${c.key} ${c.count}건`).join("\n")}

[건별 논의 결과]
${discussionSummary}`;

  const sections = [];

  // 섹션 1: 전체 현황 요약 (시간/빈도 분석 포함)
  try {
    await new Promise(r => setTimeout(r, 500));
    const sys1 = `AZS 배터리 공장 ${reportTitle} 작성. 한국어. JSON만:
{"heading":"1. 전체 현황 요약","items":["시간대별 패턴 핵심 (60자이내)","빈도 패턴 핵심","주요 이슈 요약","KPI 또는 영향"]}`;
    const raw1 = await callClaudeRaw(sys1, ctx, { model: MODEL_REASONING, max_tokens: 600 });
    sections.push(safeJSON(raw1));
  } catch { sections.push({ heading:"1. 전체 현황 요약", items:["-"] }); }

  // 섹션 2: DEEP 이슈 종합
  try {
    await new Promise(r => setTimeout(r, 500));
    const deepCtx = grouped.DEEP.map((d, i) =>
      `이슈${i+1}: ${d.issue.eq} - 합의:${d.moderator.consensus} 충돌:${d.moderator.conflicts} 권고:${d.moderator.recommendation}`
    ).join(" / ") || "DEEP 이슈 없음";
    const sys2 = `AZS 배터리 공장 ${reportTitle}. 한국어. JSON만:
{"heading":"2. 🔴 DEEP 이슈 종합 (심각/긴급)","items":["[설비명] 합의·충돌·권고 핵심 (80자이내)","항목2","항목3"]}`;
    const raw2 = await callClaudeRaw(sys2, `${ctx}\n\nDEEP 종합: ${deepCtx}`, { model: MODEL_REASONING, max_tokens: 700 });
    sections.push(safeJSON(raw2));
  } catch { sections.push({ heading:"2. 🔴 DEEP 이슈 종합", items:["-"] }); }

  // 섹션 3: STANDARD 이슈 액션
  try {
    await new Promise(r => setTimeout(r, 500));
    const stdCtx = grouped.STANDARD.map((d, i) =>
      `이슈${i+1}: ${d.issue.eq} - ${d.moderator.summary} | 액션: ${(d.moderator.actions || []).map(a => a.action).join(", ")}`
    ).join(" / ") || "STANDARD 이슈 없음";
    const sys3 = `AZS 배터리 공장 ${reportTitle}. 한국어. JSON만:
{"heading":"3. 🟡 STANDARD 이슈 액션 플랜 (미완료)","items":["[설비명] 액션·담당·우선순위 (80자이내)","항목2","항목3"]}`;
    const raw3 = await callClaudeRaw(sys3, `${ctx}\n\nSTANDARD: ${stdCtx}`, { model: MODEL_REASONING, max_tokens: 700 });
    sections.push(safeJSON(raw3));
  } catch { sections.push({ heading:"3. 🟡 STANDARD 이슈 액션 플랜", items:["-"] }); }

  // 섹션 4: 담당자별 종합 액션
  try {
    await new Promise(r => setTimeout(r, 500));
    const sys4 = `AZS 배터리 공장 ${reportTitle}. 한국어. JSON만:
{"heading":"4. 담당자별 액션 아이템","items":["[Cell_PE] 조치 (60자이내)","[Cell_ME] 조치","[Cell_TE] 조치","[Cell_FA] 조치 (해당시)","[Cell_Vision] 조치 (해당시)"]}`;
    const raw4 = await callClaudeRaw(sys4, ctx, { model: MODEL_REASONING, max_tokens: 600 });
    sections.push(safeJSON(raw4));
  } catch { sections.push({ heading:"4. 담당자별 액션 아이템", items:["-"] }); }

  // 섹션 5: 재발방지 및 차기 계획
  try {
    await new Promise(r => setTimeout(r, 500));
    const sys5 = `AZS 배터리 공장 ${reportTitle}. 한국어. JSON만:
{"heading":"5. 재발방지 대책 및 차기 계획","items":["재발방지 핵심 대책 (60자이내)","장기 개선 과제","모니터링 항목","차기 일정"]}`;
    const raw5 = await callClaudeRaw(sys5, ctx, { model: MODEL_REASONING, max_tokens: 600 });
    sections.push(safeJSON(raw5));
  } catch { sections.push({ heading:"5. 재발방지 대책 및 차기 계획", items:["-"] }); }

  return {
    title: `${dateStr} ${reportTitle}`,
    date: dateStr,
    attendees: "Cell_PE, Cell_ME, Cell_TE, Cell_FA, Cell_Vision (이슈별 자동 선정)",
    agenda: `다운타임 ${priority.urgent.length + priority.important.length + priority.normal.length}건 분석 및 대책 수립`,
    sections,
    discussions,
    analytics,
    grouped,
  };
}

// ─── UI 헬퍼 ──────────────────────────────────────────────────────────────────
function Spinner() {
  return <span style={{
    display:"inline-block", width:13, height:13,
    border:"2px solid rgba(255,255,255,0.2)",
    borderTop:"2px solid currentColor", borderRadius:"50%",
    animation:"spin 0.7s linear infinite",
  }}/>;
}

function BackBtn({ onClick, label="← 이전" }) {
  return (
    <button onClick={onClick} style={{
      padding:"9px 16px",
      background:"transparent", border:"1.5px solid rgba(51,65,85,0.4)",
      borderRadius:8, color:"#475569", fontSize:12, cursor:"pointer",
    }}>{label}</button>
  );
}

function StepBar({ step }) {
  const STEPS = ["업로드","날짜","보고서","이슈 확인","논의 중","문서 생성"];
  return (
    <div style={{ display:"flex", borderBottom:"1px solid rgba(51,65,85,0.3)", background:"rgba(3,6,13,0.85)", overflowX:"auto" }}>
      {STEPS.map((s,i) => (
        <div key={i} style={{
          flex:"1 0 auto", padding:"10px 6px", textAlign:"center",
          background: step===i ? "rgba(34,211,238,0.08)" : "transparent",
          borderBottom:`2px solid ${step===i ? "#22d3ee" : step>i ? "#34d399" : "transparent"}`,
          fontSize:9, fontWeight:800,
          color: step===i ? "#22d3ee" : step>i ? "#34d399" : "#374151",
        }}>
          <div style={{ fontSize:9, marginBottom:2 }}>{i+1}</div>
          {s}
        </div>
      ))}
    </div>
  );
}

const MODE_STYLE = {
  DEEP:     { color:"#ef4444", bg:"rgba(239,68,68,0.1)",  border:"rgba(239,68,68,0.3)",  label:"🔴 DEEP" },
  STANDARD: { color:"#f59e0b", bg:"rgba(245,158,11,0.1)", border:"rgba(245,158,11,0.3)", label:"🟡 STANDARD" },
  LITE:     { color:"#22c55e", bg:"rgba(34,197,94,0.1)",  border:"rgba(34,197,94,0.3)",  label:"🟢 LITE" },
};

// ─── 메인 앱 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep]           = useState(0);
  const [allMsgs, setAllMsgs]     = useState([]);
  const [dates, setDates]         = useState([]);
  const [selDates, setSelDates]   = useState([]);
  const [reportType, setReportType] = useState("meeting");
  const [classified, setClassified] = useState(null);
  const [priority, setPriority]   = useState(null);
  const [kbStats, setKbStats]     = useState(null);
  const [discussions, setDiscussions] = useState([]);
  const [minutes, setMinutes]     = useState(null);
  const [progress, setProgress]   = useState([]);
  const [running, setRunning]     = useState(false);
  const [error, setError]         = useState("");
  const [sheetSaved, setSheetSaved] = useState(false);
  const fileRef = useRef();

  const toggleDate = (d) => {
    setSelDates(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    );
  };

  const handleReportTypeSelect = (rt) => {
    setReportType(rt);
    if (rt === "weekly" && selDates.length > 0) {
      const weekDates = getWeekDates(selDates[0]);
      const available = weekDates.filter(d => dates.includes(d));
      setSelDates(available);
    }
  };

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const msgs = parseWhatsApp(text);
    const ds = getUniqueDates(msgs);
    setAllMsgs(msgs);
    setDates(ds);
    setSelDates([ds[ds.length-1]]);
    setStep(1);
    setError("");
  };

  const handleDateConfirm = () => {
    if (selDates.length === 0) return;
    setStep(2);
    setError("");
  };

  const handleReportConfirm = () => {
    const dayMsgs = filterByDates(allMsgs, selDates);
    const cl = classifyMessages(dayMsgs);
    const pri = classifyPriority(cl.downtime);
    setClassified(cl);
    setPriority(pri);
    setStep(3);
    setError("");
  };

  const runAnalysis = async () => {
    setRunning(true); setError(""); setProgress([]);
    setDiscussions([]); setMinutes(null); setSheetSaved(false);

    try {
      // 학습 내용 로드 (5종)
      setProgress(["📚 학습 내용 로드 중 (5종)..."]);
      let kbResult;
      try {
        kbResult = await loadAllKnowledge();
        setKbStats(kbResult.stats);
        const statsStr = ["Cell_PE", "Cell_ME", "Cell_TE", "Cell_FA", "Cell_Vision"]
          .map(r => `${r.replace("Cell_","")}:${kbResult.stats[r]}`)
          .join(" ");
        setProgress(p => [...p, `✅ 학습 로드 완료 (${statsStr})`]);
      } catch {
        kbResult = {
          kb: { Cell_PE:"", Cell_ME:"", Cell_TE:"", Cell_FA:"", Cell_Vision:"" },
          stats: { Cell_PE:0, Cell_ME:0, Cell_TE:0, Cell_FA:0, Cell_Vision:0, failed:5 }
        };
        setKbStats(kbResult.stats);
        setProgress(p => [...p, "⚠️ 학습 로드 실패 — 기본 역할로 진행"]);
      }

      // 심층 분석 대상 (긴급+중요)
      const keyIssues = selectKeyIssues(priority);
      // 일반 이슈는 LITE로 모두 처리 (옵션)
      const liteIssues = priority.normal.slice(0, MAX_ISSUES); // 최대 10건만
      const allTargets = [...keyIssues, ...liteIssues];

      setProgress(p => [...p, `🔍 심층 분석 대상: 긴급/중요 ${keyIssues.length}건 + 일반(LITE) ${liteIssues.length}건`]);

      // 모드 분류 + 건별 논의
      const allDiscussions = [];

      // 긴급+중요 처리
      for (let i = 0; i < keyIssues.length; i++) {
        const issue = keyIssues[i];
        const isPriUrgent = priority.urgent.includes(issue);
        const isPriImportant = priority.important.includes(issue);
        const modeInfo = classifyDiscussionMode(issue, isPriUrgent, isPriImportant);
        const mStyle = MODE_STYLE[modeInfo.mode];

        setProgress(p => [...p, `${mStyle.label} [${i+1}/${keyIssues.length}] ${issue.eq} (${modeInfo.reason})`]);

        const result = await runIssueDiscussion(issue, modeInfo, kbResult.kb, reportType, (msg) => {
          setProgress(p => [...p, `   ${msg}`]);
        });
        allDiscussions.push(result);
        setDiscussions([...allDiscussions]);
      }

      // 일반(LITE) 처리
      for (let i = 0; i < liteIssues.length; i++) {
        const issue = liteIssues[i];
        const modeInfo = classifyDiscussionMode(issue, false, false);
        // 키워드 강제 DEEP인 경우 처리 분기
        if (modeInfo.mode === "DEEP") {
          setProgress(p => [...p, `🚨 LITE 후보였으나 키워드 감지로 DEEP 강제: ${issue.eq}`]);
        }
        setProgress(p => [...p, `${MODE_STYLE[modeInfo.mode].label} [LITE-${i+1}/${liteIssues.length}] ${issue.eq}`]);
        const result = await runIssueDiscussion(issue, modeInfo, kbResult.kb, reportType);
        allDiscussions.push(result);
        setDiscussions([...allDiscussions]);
      }

      // 보고서 생성
      setProgress(p => [...p, "📄 보고서 생성 중..."]);
      const dateStr = selDates.length > 1 ? `${selDates[0]}~${selDates[selDates.length-1]}` : selDates[0];
      const allIssuesForAnalytics = [...priority.urgent, ...priority.important, ...priority.normal];
      const report = await generateReport(dateStr, selDates, allDiscussions, priority, reportType, kbResult.kb, allIssuesForAnalytics);
      setMinutes(report);

      // 시트 저장 (모드별 정리해서 저장)
      setProgress(p => [...p, "💾 구글 시트 저장 중..."]);
      const deepSummary = report.grouped.DEEP.map(d => `${d.issue.eq}: ${d.moderator.consensus}`).join(" | ");
      const stdSummary = report.grouped.STANDARD.map(d => `${d.issue.eq}: ${d.moderator.summary}`).join(" | ");
      const liteSummary = report.grouped.LITE.map(d => `${d.issue.eq}: ${d.moderator.supplement}`).join(" | ");

      const saved = await saveToSheets({
        date: dateStr,
        agenda: report.agenda,
        issue_summary: `긴급${priority.urgent.length} 중요${priority.important.length} 일반${priority.normal.length} | DEEP${report.grouped.DEEP.length} STANDARD${report.grouped.STANDARD.length} LITE${report.grouped.LITE.length}`,
        pe_opinion: deepSummary.slice(0, 500),
        me_opinion: stdSummary.slice(0, 500),
        te_opinion: liteSummary.slice(0, 500),
        discussion: report.sections.map(s => `${s.heading}: ${(s.items||[]).join(", ")}`).join(" / ").slice(0, 2000),
        action_items: report.sections[3]?.items?.join(" | ") || "",
        minutes_full: JSON.stringify({
          analytics: report.analytics,
          modeStats: { DEEP: report.grouped.DEEP.length, STANDARD: report.grouped.STANDARD.length, LITE: report.grouped.LITE.length },
        }).slice(0, 1000),
      });
      setSheetSaved(saved);
      setStep(4);
      setProgress(p => [...p, "✅ 완료!"]);

    } catch(e) { setError(e.message); }
    finally { setRunning(false); }
  };

  const downloadTxt = () => {
    if (!minutes) return;
    let t = `${"═".repeat(52)}\n${minutes.title}\n${"═".repeat(52)}\n`;
    t += `일시: ${minutes.date}\n참석: ${minutes.attendees}\n안건: ${minutes.agenda}\n`;

    // 시간/빈도 분석
    if (minutes.analytics) {
      t += `\n${"═".repeat(52)}\n📊 이슈 분석 요약\n${"═".repeat(52)}\n`;
      t += `\n⏰ 시간대별 발생 TOP 5\n`;
      minutes.analytics.timeOfDay.forEach((b, i) => {
        t += `  ${i+1}. ${b.label}  ${b.count}건\n`;
      });
      t += `\n🔁 발생 빈도 TOP 5 (설비 × 라인)\n`;
      minutes.analytics.categoryFreq.forEach((c, i) => {
        t += `  ${i+1}. ${c.key}  ${c.count}건\n`;
      });
    }

    // 모드별 건별 논의 결과
    if (discussions.length > 0) {
      t += `\n${"═".repeat(52)}\n건별 논의 결과 (모드별)\n${"═".repeat(52)}\n`;
      for (const mode of ["DEEP", "STANDARD", "LITE"]) {
        const items = (minutes.grouped?.[mode]) || [];
        if (items.length === 0) continue;
        t += `\n${MODE_STYLE[mode].label} (${items.length}건)\n${"─".repeat(40)}\n`;
        items.forEach((d, i) => {
          t += `\n[${mode}-${i+1}] ${d.issue.eq} (${d.issue.durMin}분, ${d.issue.time})\n`;
          t += `  분류: ${d.modeInfo.reason} (${d.modeInfo.source})\n`;
          if (d.router) t += `  발언 순서: ${d.router.order.join(" → ")} (${d.router.reason})\n`;

          // 페르소나 의견
          if (d.opinions.length > 0) {
            t += `\n  ── 페르소나 의견 ──\n`;
            d.opinions.forEach(o => {
              const p = PERSONAS[o.persona];
              t += `  ${p.icon} ${p.label} (${o.persona})\n`;
              t += `     분석: ${o.opinion?.analysis}\n`;
              t += `     조치: ${o.opinion?.action}\n`;
              t += `     재발방지: ${o.opinion?.prevention}\n`;
            });
          }

          // 사회자 종합
          t += `\n  ── 사회자 종합 ──\n`;
          const m = d.moderator;
          if (m.type === "deep") {
            t += `     【합의】 ${m.consensus}\n`;
            t += `     【차이】 ${m.differences}\n`;
            t += `     【충돌】 ${m.conflicts}\n`;
            t += `     【권고】 ${m.recommendation}\n`;
            t += `     【추가】 ${m.needsMore}\n`;
          } else if (m.type === "standard") {
            t += `     요약: ${m.summary}\n`;
            (m.actions || []).forEach((a, ai) => {
              t += `     액션${ai+1}: [${a.priority}] ${a.action} (담당:${a.owner}, ${a.duration})\n`;
            });
            t += `     추가확인: ${m.needsMore}\n`;
          } else {
            t += `     보완점: ${m.supplement}\n`;
            t += `     재발우려: ${m.recurRisk}\n`;
            t += `     재발방지: ${m.prevention}\n`;
          }
          t += `${"─".repeat(40)}\n`;
        });
      }
    }

    // 보고서 섹션
    t += `\n${"═".repeat(52)}\n종합 보고서\n${"═".repeat(52)}\n`;
    for (const s of minutes.sections||[]) {
      t += `\n${s.heading}\n${"─".repeat(28)}\n`;
      for (const item of s.items||[]) t += `  · ${item}\n`;
    }
    t += `\n${"─".repeat(52)}\n※ AI 생성 보고서`;
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([t], { type:"text/plain;charset=utf-8" })),
      download:`${minutes.title}.txt`,
    }).click();
  };

  const reset = () => {
    setStep(0); setAllMsgs([]); setDates([]); setSelDates([]);
    setClassified(null); setPriority(null); setKbStats(null);
    setDiscussions([]); setMinutes(null); setProgress([]);
    setError(""); setSheetSaved(false); setReportType("meeting");
  };

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(150deg,#03060d,#060d1c 55%,#040810)",
      fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif", color:"#e2e8f0",
    }}>
      {/* Header */}
      <div style={{
        background:"rgba(3,6,13,0.96)", backdropFilter:"blur(12px)",
        borderBottom:"1px solid rgba(34,211,238,0.12)",
        padding:"12px 20px", position:"sticky", top:0, zIndex:100,
        display:"flex", alignItems:"center", gap:12,
      }}>
        <div style={{
          width:34, height:34, borderRadius:8,
          background:"linear-gradient(135deg,#3b82f6,#22d3ee)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:17,
        }}>🏭</div>
        <div>
          <div style={{fontSize:13,fontWeight:800,color:"#f1f5f9"}}>AZS Cell 라인 · 논의 시스템 v2 · 보고서</div>
          <div style={{fontSize:9,color:"#22d3ee",letterSpacing:2,fontWeight:700}}>PE · ME · TE · FA · Vision  |  AZS</div>
        </div>
        {step > 0 && (
          <button onClick={reset} style={{
            marginLeft:"auto", padding:"5px 12px",
            background:"rgba(51,65,85,0.4)", border:"1px solid rgba(51,65,85,0.5)",
            borderRadius:6, color:"#64748b", fontSize:11, cursor:"pointer",
          }}>처음으로</button>
        )}
      </div>

      <StepBar step={step}/>

      <div style={{maxWidth:720, margin:"0 auto", padding:"24px 18px 60px"}}>

        {/* STEP 0: 파일 업로드 */}
        {step===0 && (
          <div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>WhatsApp 채팅 파일 업로드</div>
              <div style={{fontSize:12,color:"#475569"}}>WhatsApp → 채팅 내보내기 → txt 파일</div>
            </div>
            <div onClick={()=>fileRef.current?.click()} style={{
              border:"2px dashed rgba(34,211,238,0.3)", borderRadius:12,
              padding:"48px 20px", textAlign:"center", cursor:"pointer",
              background:"rgba(34,211,238,0.03)", marginBottom:20,
            }}>
              <input ref={fileRef} type="file" accept=".txt" onChange={handleFile} style={{display:"none"}}/>
              <div style={{fontSize:40,marginBottom:12}}>📂</div>
              <div style={{fontSize:14,color:"#22d3ee",fontWeight:700}}>클릭하여 txt 파일 선택</div>
              <div style={{fontSize:11,color:"#374151",marginTop:4}}>WhatsApp 채팅 내보내기 (.txt)</div>
            </div>
            <div style={{
              padding:"10px 14px", background:"rgba(34,211,238,0.05)",
              border:"1px solid rgba(34,211,238,0.2)", borderRadius:8,
              fontSize:11, color:"#22d3ee", lineHeight:1.7,
            }}>
              💡 날짜 기준: 06:00 이전 메시지는 전날 생산분으로 처리됩니다<br/>
              🆕 v2: TE 우선 발언 + 차등 논의 모드 + 5섹션 사회자 + 시간/빈도 분석
            </div>
          </div>
        )}

        {/* STEP 1: 날짜 선택 */}
        {step===1 && (
          <div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>날짜 선택</div>
              <div style={{fontSize:12,color:"#475569"}}>
                총 {dates.length}일치 데이터 · 여러 날짜 함께 선택 가능
              </div>
            </div>

            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <button onClick={()=>setSelDates([...dates])} style={{
                padding:"5px 12px", background:"rgba(34,211,238,0.1)",
                border:"1px solid rgba(34,211,238,0.3)", borderRadius:6,
                color:"#22d3ee", fontSize:11, cursor:"pointer",
              }}>전체 선택</button>
              <button onClick={()=>setSelDates([])} style={{
                padding:"5px 12px", background:"rgba(51,65,85,0.3)",
                border:"1px solid rgba(51,65,85,0.4)", borderRadius:6,
                color:"#64748b", fontSize:11, cursor:"pointer",
              }}>전체 해제</button>
              <span style={{fontSize:11,color:"#22d3ee",marginLeft:"auto",alignSelf:"center"}}>
                {selDates.length}일 선택됨
              </span>
            </div>

            <div style={{
              maxHeight:320, overflowY:"auto",
              background:"rgba(4,8,16,0.6)", border:"1px solid rgba(51,65,85,0.3)",
              borderRadius:10, padding:"8px", marginBottom:16,
            }}>
              {[...dates].reverse().map(d => {
                const count = allMsgs.filter(m => getProductionDate(m.date,m.hour)===d).length;
                const isSelected = selDates.includes(d);
                return (
                  <div key={d} onClick={()=>toggleDate(d)} style={{
                    display:"flex", alignItems:"center", gap:12,
                    padding:"10px 12px", borderRadius:8, cursor:"pointer",
                    background: isSelected ? "rgba(34,211,238,0.1)" : "transparent",
                    border: `1px solid ${isSelected ? "rgba(34,211,238,0.3)" : "transparent"}`,
                    marginBottom:4,
                  }}>
                    <div style={{
                      width:18, height:18, borderRadius:4,
                      background: isSelected ? "#22d3ee" : "transparent",
                      border:`2px solid ${isSelected ? "#22d3ee" : "rgba(51,65,85,0.6)"}`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:11, color:"#fff", flexShrink:0,
                    }}>{isSelected ? "✓" : ""}</div>
                    <span style={{fontSize:13, color: isSelected ? "#22d3ee" : "#94a3b8", fontWeight: isSelected ? 700 : 400}}>
                      {d}
                    </span>
                    <span style={{fontSize:11, color:"#475569", marginLeft:"auto"}}>{count}건</span>
                  </div>
                );
              })}
            </div>

            <div style={{display:"flex",gap:10}}>
              <BackBtn onClick={()=>setStep(0)} label="← 파일 재선택"/>
              <button onClick={handleDateConfirm} disabled={selDates.length===0} style={{
                flex:1, padding:"12px",
                background:selDates.length>0?"linear-gradient(135deg,#3b82f6,#22d3ee)":"rgba(51,65,85,0.3)",
                border:"none", borderRadius:8,
                color:selDates.length>0?"#fff":"#374151",
                fontSize:13, fontWeight:800,
                cursor:selDates.length>0?"pointer":"not-allowed",
              }}>보고서 종류 선택 →</button>
            </div>
          </div>
        )}

        {/* STEP 2: 보고서 종류 선택 */}
        {step===2 && (
          <div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>어떤 문서를 만들까요?</div>
              <div style={{fontSize:12,color:"#475569"}}>
                선택한 보고서 종류에 맞게 AI가 논의를 진행합니다
                {reportType==="weekly" && (
                  <span style={{color:"#22d3ee"}}> · 주간 선택 시 해당 주 날짜 자동 선택</span>
                )}
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              {REPORT_TYPES.map(rt => (
                <button key={rt.id} onClick={()=>handleReportTypeSelect(rt.id)} style={{
                  padding:"18px 16px", textAlign:"left",
                  background: reportType===rt.id ? "rgba(167,139,250,0.15)" : "rgba(20,30,50,0.7)",
                  border:`2px solid ${reportType===rt.id ? "#a78bfa" : "rgba(51,65,85,0.5)"}`,
                  borderRadius:12, color: reportType===rt.id ? "#a78bfa" : "#64748b",
                  cursor:"pointer", transition:"all 0.2s",
                  transform: reportType===rt.id ? "translateY(-2px)" : "none",
                }}>
                  <div style={{fontSize:28,marginBottom:8}}>{rt.icon}</div>
                  <div style={{fontSize:13,fontWeight:800,marginBottom:4}}>{rt.label}</div>
                  <div style={{fontSize:10,opacity:0.7,lineHeight:1.5}}>{rt.desc}</div>
                </button>
              ))}
            </div>

            {reportType==="weekly" && selDates.length > 1 && (
              <div style={{
                padding:"10px 14px", background:"rgba(34,211,238,0.06)",
                border:"1px solid rgba(34,211,238,0.2)", borderRadius:8,
                fontSize:11, color:"#22d3ee", marginBottom:16,
              }}>
                📅 해당 주 자동 선택: {selDates.join(", ")}
              </div>
            )}

            <div style={{display:"flex",gap:10}}>
              <BackBtn onClick={()=>setStep(1)} label="← 날짜 선택"/>
              <button onClick={handleReportConfirm} style={{
                flex:1, padding:"12px",
                background:"linear-gradient(135deg,#a78bfa,#7c3aed)",
                border:"none", borderRadius:8, color:"#fff",
                fontSize:13, fontWeight:800, cursor:"pointer",
              }}>이슈 확인 →</button>
            </div>
          </div>
        )}

        {/* STEP 3: 이슈 확인 */}
        {step===3 && classified && priority && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>
                {selDates.length > 1 ? `${selDates[0]} ~ ${selDates[selDates.length-1]}` : selDates[0]} 이슈 현황
              </div>
            </div>

            {kbStats && (
              <div style={{
                background: kbStats.failed>0 ? "rgba(245,158,11,0.06)" : "rgba(52,211,153,0.06)",
                border:`1px solid ${kbStats.failed>0 ? "rgba(245,158,11,0.25)" : "rgba(52,211,153,0.25)"}`,
                borderRadius:8, padding:"8px 12px", marginBottom:12,
                fontSize:10, display:"flex", gap:10, alignItems:"center", flexWrap:"wrap",
              }}>
                <span style={{color:kbStats.failed>0?"#f59e0b":"#34d399",fontWeight:800}}>
                  {kbStats.failed>0?"⚠️ 학습 일부 로드 실패":"✅ 학습 로드 완료"}
                </span>
                {Object.entries(PERSONAS).map(([k, p]) => (
                  <span key={k} style={{color:p.color}}>{p.icon}{k.replace("Cell_","")}:{kbStats[k] || 0}건</span>
                ))}
              </div>
            )}

            <div style={{display:"flex",gap:10,marginBottom:14}}>
              {[
                {label:"🔴 긴급",count:priority.urgent.length,color:"#ef4444",bg:"rgba(239,68,68,0.08)",border:"rgba(239,68,68,0.25)"},
                {label:"🟡 중요",count:priority.important.length,color:"#f59e0b",bg:"rgba(245,158,11,0.08)",border:"rgba(245,158,11,0.25)"},
                {label:"🟢 일반",count:priority.normal.length,color:"#22c55e",bg:"rgba(34,197,94,0.08)",border:"rgba(34,197,94,0.25)"},
              ].map(p => (
                <div key={p.label} style={{
                  flex:1, background:p.bg, border:`1px solid ${p.border}`,
                  borderRadius:8, padding:"10px", textAlign:"center",
                }}>
                  <div style={{fontSize:20,fontWeight:800,color:p.color}}>{p.count}</div>
                  <div style={{fontSize:10,color:p.color,fontWeight:700}}>{p.label}</div>
                </div>
              ))}
            </div>

            <div style={{
              background:"rgba(167,139,250,0.06)", border:"1px solid rgba(167,139,250,0.2)",
              borderRadius:10, padding:"12px 14px", marginBottom:12,
            }}>
              <div style={{fontSize:10,color:"#a78bfa",fontWeight:800,marginBottom:8}}>
                🔍 차등 논의 모드 (예상)
              </div>
              <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.7}}>
                🔴 DEEP: 긴급 {priority.urgent.length}건 (5섹션 풀 논의)<br/>
                🟡 STANDARD: 중요 {priority.important.length}건 (액션 플랜)<br/>
                🟢 LITE: 일반 최대 {Math.min(priority.normal.length, MAX_ISSUES)}건 (사회자 압축)<br/>
                <span style={{color:"#a78bfa",fontWeight:800}}>
                  총 {Math.min(priority.urgent.length + priority.important.length, MAX_ISSUES) + Math.min(priority.normal.length, MAX_ISSUES)}건 분석 예정
                </span>
              </div>
              <div style={{fontSize:9,color:"#475569",marginTop:6}}>
                ※ 안전·환경·SAR/NCR/HOLD 키워드 감지 시 자동 DEEP 강제
              </div>
            </div>

            {priority.urgent.length > 0 && (
              <div style={{
                background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.2)",
                borderRadius:10, padding:"12px 14px", marginBottom:10,
              }}>
                <div style={{fontSize:10,color:"#ef4444",fontWeight:800,marginBottom:8}}>
                  🔴 긴급 이슈 ({priority.urgent.length}건)
                </div>
                {priority.urgent.map((d,i) => (
                  <div key={i} style={{fontSize:11,color:"#fca5a5",marginBottom:5}}>
                    <span style={{color:"#ef4444",fontWeight:700}}>[{d.time}] {d.eq}</span>
                    <span style={{color:"#94a3b8"}}> · {d.durMin}분 · {d.prob}</span>
                    <span style={{color:"#ef4444",fontSize:9,marginLeft:6}}>({d.reasons?.join(", ")})</span>
                  </div>
                ))}
              </div>
            )}

            {priority.important.length > 0 && (
              <div style={{
                background:"rgba(245,158,11,0.05)", border:"1px solid rgba(245,158,11,0.2)",
                borderRadius:10, padding:"12px 14px", marginBottom:14,
              }}>
                <div style={{fontSize:10,color:"#f59e0b",fontWeight:800,marginBottom:8}}>
                  🟡 중요 이슈 ({priority.important.length}건)
                </div>
                {priority.important.slice(0,5).map((d,i) => (
                  <div key={i} style={{fontSize:11,color:"#fcd34d",marginBottom:5}}>
                    <span style={{color:"#f59e0b",fontWeight:700}}>[{d.time}] {d.eq}</span>
                    <span style={{color:"#94a3b8"}}> · {d.durMin}분 · {d.prob}</span>
                    <span style={{color:"#f59e0b",fontSize:9,marginLeft:6}}>({d.reasons?.join(", ")})</span>
                  </div>
                ))}
                {priority.important.length > 5 && (
                  <div style={{fontSize:10,color:"#78716c"}}>외 {priority.important.length-5}건</div>
                )}
              </div>
            )}

            <div style={{
              background:"rgba(167,139,250,0.06)", border:"1px solid rgba(167,139,250,0.2)",
              borderRadius:8, padding:"10px 14px", marginBottom:14,
              display:"flex", alignItems:"center", justifyContent:"space-between",
            }}>
              <span style={{fontSize:11,color:"#a78bfa",fontWeight:700}}>
                {REPORT_TYPES.find(r=>r.id===reportType)?.icon} {REPORT_TYPES.find(r=>r.id===reportType)?.label}
              </span>
              <button onClick={()=>setStep(2)} style={{
                background:"transparent", border:"1px solid rgba(167,139,250,0.3)",
                borderRadius:5, color:"#a78bfa", fontSize:10, cursor:"pointer", padding:"2px 8px",
              }}>변경</button>
            </div>

            {progress.length > 0 && (
              <div style={{
                background:"rgba(15,23,42,0.7)", border:"1px solid rgba(51,65,85,0.3)",
                borderRadius:10, padding:"14px 16px", marginBottom:14,
                maxHeight:280, overflowY:"auto",
              }}>
                {progress.map((p,i) => (
                  <div key={i} style={{
                    fontSize:11, color: p.startsWith("✅") ? "#34d399" : p.startsWith("⚠️") ? "#f59e0b" : p.startsWith("🚨") ? "#ef4444" : "#94a3b8",
                    marginBottom:6, display:"flex", alignItems:"center", gap:8,
                  }}>
                    {i === progress.length-1 && running && <Spinner/>}
                    {p}
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div style={{
                padding:"10px 14px", background:"rgba(239,68,68,0.08)",
                border:"1px solid rgba(239,68,68,0.25)", borderRadius:8,
                fontSize:11, color:"#fca5a5", marginBottom:12,
                wordBreak:"break-all", lineHeight:1.6, whiteSpace:"pre-wrap",
              }}>❌ {error}</div>
            )}

            <div style={{display:"flex",gap:10}}>
              <BackBtn onClick={()=>setStep(2)} label="← 보고서 변경"/>
              <button onClick={runAnalysis} disabled={running} style={{
                flex:1, padding:"12px",
                background:running?"rgba(51,65,85,0.3)":"linear-gradient(135deg,#3b82f6,#22d3ee)",
                border:"none", borderRadius:8,
                color:running?"#374151":"#fff",
                fontSize:13, fontWeight:800,
                cursor:running?"not-allowed":"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              }}>
                {running?<><Spinner/>분석 진행 중...</>:"🔍 차등 논의 및 보고서 생성 →"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: 결과 */}
        {step===4 && minutes && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>보고서 완성</div>
              {sheetSaved && (
                <div style={{fontSize:11,color:"#34d399"}}>✅ 구글 시트에 자동 저장 완료</div>
              )}
            </div>

            {/* 시간/빈도 분석 */}
            {minutes.analytics && (
              <div style={{
                background:"rgba(15,23,42,0.7)",
                border:"1px solid rgba(34,211,238,0.25)",
                borderRadius:10, padding:"14px 16px", marginBottom:14,
              }}>
                <div style={{fontSize:12,fontWeight:800,color:"#22d3ee",marginBottom:10}}>
                  📊 이슈 분석 요약 (총 {minutes.analytics.total}건)
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <div>
                    <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,marginBottom:6}}>⏰ 시간대 TOP 5</div>
                    {minutes.analytics.timeOfDay.length === 0 ? (
                      <div style={{fontSize:10,color:"#475569"}}>데이터 없음</div>
                    ) : minutes.analytics.timeOfDay.map((b, i) => {
                      const max = minutes.analytics.timeOfDay[0].count;
                      return (
                        <div key={b.hour} style={{fontSize:10,marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                          <span style={{color:"#cbd5e1",width:90}}>{i+1}. {b.label}</span>
                          <span style={{flex:1,height:6,background:"rgba(51,65,85,0.4)",borderRadius:3,overflow:"hidden"}}>
                            <span style={{display:"block",height:"100%",width:`${(b.count/max)*100}%`,background:"#22d3ee"}}/>
                          </span>
                          <span style={{color:"#22d3ee",width:30,textAlign:"right"}}>{b.count}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,marginBottom:6}}>🔁 빈도 TOP 5 (설비)</div>
                    {minutes.analytics.categoryFreq.length === 0 ? (
                      <div style={{fontSize:10,color:"#475569"}}>데이터 없음</div>
                    ) : minutes.analytics.categoryFreq.map((c, i) => (
                      <div key={c.key} style={{fontSize:10,marginBottom:4,display:"flex",justifyContent:"space-between"}}>
                        <span style={{color:"#cbd5e1"}}>{i+1}. {c.eq}</span>
                        <span style={{color:"#22d3ee"}}>{c.count}건</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 모드별 분석 결과 */}
            {discussions.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{
                  fontSize:12, fontWeight:800, color:"#f1f5f9", marginBottom:10,
                  padding:"8px 14px", background:"rgba(167,139,250,0.1)",
                  border:"1px solid rgba(167,139,250,0.2)", borderRadius:8,
                }}>
                  🔍 차등 논의 결과 ({discussions.length}건) ·
                  🔴{minutes.grouped?.DEEP?.length || 0}
                  🟡{minutes.grouped?.STANDARD?.length || 0}
                  🟢{minutes.grouped?.LITE?.length || 0}
                </div>

                {["DEEP", "STANDARD", "LITE"].map(modeKey => {
                  const items = minutes.grouped?.[modeKey] || [];
                  if (items.length === 0) return null;
                  const mStyle = MODE_STYLE[modeKey];
                  return (
                    <div key={modeKey} style={{marginBottom:14}}>
                      <div style={{
                        fontSize:11,fontWeight:800,color:mStyle.color,
                        padding:"6px 12px",background:mStyle.bg,
                        border:`1px solid ${mStyle.border}`,borderRadius:6,
                        marginBottom:8,
                      }}>{mStyle.label} ({items.length}건)</div>

                      {items.map((d, idx) => (
                        <DiscussionCard key={idx} discussion={d}/>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 보고서 */}
            <div style={{
              background:"rgba(248,250,252,0.97)", borderRadius:12,
              color:"#1e293b", padding:"28px 32px", marginBottom:14,
              boxShadow:"0 20px 60px rgba(0,0,0,0.5)",
              fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
            }}>
              <div style={{borderBottom:"3px solid #1d4ed8",paddingBottom:14,marginBottom:18}}>
                <div style={{fontSize:9,letterSpacing:3,color:"#3b82f6",fontWeight:800,marginBottom:5}}>
                  {REPORT_TYPES.find(r=>r.id===reportType)?.label.toUpperCase()}
                </div>
                <div style={{fontSize:18,fontWeight:900,color:"#0f172a",marginBottom:8}}>
                  {minutes.title}
                </div>
                <div style={{display:"flex",gap:16,fontSize:11,color:"#64748b",flexWrap:"wrap"}}>
                  <span>📅 {minutes.date}</span>
                  <span>👥 {minutes.attendees}</span>
                </div>
                <div style={{marginTop:6,fontSize:11,color:"#475569"}}>
                  <span style={{fontWeight:700}}>안건: </span>{minutes.agenda}
                </div>
              </div>
              {(minutes.sections||[]).map((sec,i) => (
                <div key={i} style={{marginBottom:16}}>
                  <div style={{
                    fontSize:11,fontWeight:800,color:"#1d4ed8",
                    background:"#dbeafe",padding:"4px 10px",
                    borderRadius:5,marginBottom:8,display:"inline-block",
                  }}>{sec.heading}</div>
                  <ul style={{margin:0,padding:0,listStyle:"none"}}>
                    {(sec.items||[]).map((item,j) => (
                      <li key={j} style={{
                        fontSize:12,color:"#334155",lineHeight:1.8,
                        paddingLeft:14,position:"relative",
                      }}>
                        <span style={{position:"absolute",left:0,color:"#3b82f6"}}>·</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div style={{
                borderTop:"1px solid #e2e8f0",paddingTop:10,marginTop:4,
                fontSize:10,color:"#94a3b8",textAlign:"right",
              }}>
                AI 생성 보고서 · {new Date().toLocaleString("ko-KR")}
              </div>
            </div>

            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <button onClick={downloadTxt} style={{
                flex:1, padding:"11px",
                background:"linear-gradient(135deg,#3b82f6,#22d3ee)",
                border:"none", borderRadius:8, color:"#fff",
                fontSize:13, fontWeight:800, cursor:"pointer",
              }}>📥 TXT 다운로드</button>
              <button onClick={()=>{setStep(3);setMinutes(null);setDiscussions([]);setProgress([]);}} style={{
                flex:1, padding:"11px", background:"transparent",
                border:"1.5px solid rgba(167,139,250,0.35)", borderRadius:8,
                color:"#a78bfa", fontSize:13, fontWeight:800, cursor:"pointer",
              }}>🔄 다시 분석</button>
            </div>
            <button onClick={()=>{setStep(1);setMinutes(null);setDiscussions([]);setProgress([]);setReportType("meeting");}} style={{
              width:"100%", padding:"10px", background:"transparent",
              border:"1.5px solid rgba(51,65,85,0.4)", borderRadius:8,
              color:"#475569", fontSize:12, cursor:"pointer",
            }}>← 날짜 다시 선택</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box}
        button:hover:not(:disabled){filter:brightness(1.1)}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(34,211,238,0.2);border-radius:2px}
      `}</style>
    </div>
  );
}

// ─── 논의 카드 컴포넌트 ────────────────────────────────────────────────────────
function DiscussionCard({ discussion }) {
  const [showOpinions, setShowOpinions] = useState(false);
  const { issue, modeInfo, router, opinions, moderator } = discussion;
  const mStyle = MODE_STYLE[modeInfo.mode];

  return (
    <div style={{
      background:"rgba(15,23,42,0.7)",
      border:`1px solid ${mStyle.border}`,
      borderRadius:10, padding:"14px 16px", marginBottom:8,
    }}>
      {/* 헤더 */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,fontWeight:800,color:mStyle.color}}>
            [{issue.time}] {issue.eq}
          </div>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>
            {issue.durMin}분 · {issue.prob}
          </div>
        </div>
        <div style={{fontSize:9,color:mStyle.color,textAlign:"right",flexShrink:0}}>
          {modeInfo.source}
        </div>
      </div>

      {/* 분류 사유 */}
      <div style={{
        fontSize:10, color:"#cbd5e1", padding:"6px 10px",
        background:"rgba(0,0,0,0.2)", borderRadius:5, marginBottom:8,
      }}>
        📌 {modeInfo.reason}
        {router && <span style={{color:"#94a3b8"}}> | 발언순서: {router.order.map(o => PERSONAS[o]?.icon).join(" → ")}</span>}
      </div>

      {/* 사회자 종합 (메인) */}
      <div style={{
        padding:"10px 12px", background:mStyle.bg, borderRadius:6,
        fontSize:11, color:"#e2e8f0", lineHeight:1.7,
      }}>
        {moderator.type === "deep" && (
          <>
            <div><b style={{color:mStyle.color}}>【합의】</b> {moderator.consensus}</div>
            <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【차이】</b> {moderator.differences}</div>
            <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【충돌】</b> {moderator.conflicts}</div>
            <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【권고】</b> {moderator.recommendation}</div>
            {moderator.needsMore && moderator.needsMore !== "없음" && (
              <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【추가논의】</b> {moderator.needsMore}</div>
            )}
          </>
        )}
        {moderator.type === "standard" && (
          <>
            <div><b style={{color:mStyle.color}}>요약:</b> {moderator.summary}</div>
            {(moderator.actions || []).map((a, ai) => (
              <div key={ai} style={{marginTop:4,paddingLeft:8}}>
                ▸ <b style={{color:mStyle.color}}>[{a.priority}]</b> {a.action}
                <span style={{color:"#94a3b8",fontSize:10}}> (담당:{a.owner}, {a.duration})</span>
              </div>
            ))}
          </>
        )}
        {moderator.type === "lite" && (
          <>
            <div>✅ 보완점: {moderator.supplement}</div>
            <div style={{marginTop:4}}>🔁 재발우려: {moderator.recurRisk}</div>
            <div style={{marginTop:4}}>🛡️ 재발방지: {moderator.prevention}</div>
          </>
        )}
      </div>

      {/* 페르소나 의견 펼치기 (LITE는 의견 없음) */}
      {opinions.length > 0 && (
        <>
          <button onClick={()=>setShowOpinions(!showOpinions)} style={{
            marginTop:8, padding:"4px 10px", fontSize:10,
            background:"transparent", border:"1px solid rgba(51,65,85,0.5)",
            borderRadius:4, color:"#94a3b8", cursor:"pointer",
          }}>
            {showOpinions ? "▲ 페르소나 의견 접기" : `▼ 페르소나 의견 펼치기 (${opinions.length}명)`}
          </button>
          {showOpinions && (
            <div style={{marginTop:8}}>
              {opinions.map((o, i) => {
                const p = PERSONAS[o.persona];
                return (
                  <div key={i} style={{
                    background:p.bg, padding:"8px 10px", borderRadius:6, marginBottom:5,
                  }}>
                    <div style={{fontSize:10,color:p.color,fontWeight:800,marginBottom:4}}>
                      {p.icon} {p.label} ({o.persona})
                    </div>
                    <div style={{fontSize:10,color:"#cbd5e1",lineHeight:1.6}}>
                      📊 {o.opinion?.analysis}<br/>
                      ⚡ {o.opinion?.action}<br/>
                      🛡️ {o.opinion?.prevention}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
