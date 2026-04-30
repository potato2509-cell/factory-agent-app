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
  환경: ["누유", "누수", "유출", "분진", "악취", "spill"],  // 영역 12-X1: AZS 미사용 유해물질로 영문 leak 제외 (단순 공압 LEAK은 DEEP 제외)
  품질통제: ["SAR", "NCR", "HOLD", "Special Action Request", "Non-Conformance"],
  출하고객: ["고객 클레임", "반품", "출하 정지", "납품 지연", "claim"],
  라인정지: ["라인 정지", "가동 중단", "전 라인 멈춤", "올스톱", "full_stop"],
};

// ─── 영역 9-B: 5-카테고리 분류 키워드 (명세서 §4 + 부록 A 기반) ─────────────
// 한 이슈가 여러 카테고리에 속할 수 있음 (tags 배열로 다중 분류)
const QUALITY_KEYWORDS = [
  // 명세서 §4.3: NG / 품질
  "불량", "defect", "NG", "수율", "yield", "Cpk",
  "코팅 불량", "두께", "정렬", "외관", "치수",
  "SAR", "NCR", "HOLD", "스크랩", "scrap", "리젝",
  // 명세서 §10.2 QUALITY_NG 패턴
  "tab width", "sepa fold", "electrode expose", "vision NG", "appearance",
  "tab fold", "tab widht",  // tab widht는 명세서 부록 A 그대로 (오타 유지)
];

const PROCESS_CHANGE_KEYWORDS = [
  "변경", "조정", "change", "set", "setpoint",
  "recipe", "셋업", "조건", "오프셋", "offset",
  "Gap", "압력", "온도", "속도", "tuning", "튜닝",
  "파라미터", "parameter",
  // 명세서 §10.2 CONDITION_CHANGE 패턴
  "setting", "adjust",
  // ★ 영역 12-AB1: 4월 데이터 패턴 추가
  "Overhang", "overhang", "spec 초과", "Splicing", "splicing",
  "Stack NG", "stack ng", "Sepa Wrinkle", "sepa wrinkle",
  "Vision F/I check", "vision f/i", "monitoring 진행",
  "Tab guide", "tab guide", "Z cut", "z cut",
  "Magazine lift", "magazine lift", "Idle mandrel", "idle mandrel",
  "Sepa dancer", "sepa dancer", "Ejector blow", "ejector blow",
  "Down Loading", "down loading", "Down Unloading", "down unloading",
  "Set Point", "set point", "Vacuum Set", "vacuum set",
  "PnP", "Anode X", "anode x", "X value", "Y value",
  "PIC:", "pic:",  // PIC 명시 메시지 (일반적으로 setting 변경 보고)
];

const TEST_KEYWORDS = [
  "테스트", "test", "시험", "검증", "validation",
  "trial", "trial run", "샘플", "sample", "DOE",
  "양산외", "비정상 생산", "특별 생산", "엔지니어링 런",
  "engineering run", "pilot",
  // 명세서 §10.2 TEST_PM 패턴
  "swap", "swab", "calibration", "PM", "monitoring",
  // ★ 영역 12-AB2: 4월 데이터 패턴 추가
  "UBM", "ubm", "UBM Limit", "ubm limit", "Irregular Maintenance", "irregular maintenance",
  "Cleaning", "cleaning", "Check DE", "check de",
  "Cutter Sear", "cutter sear", "Top Cutter", "top cutter", "Bottom Cutter", "bottom cutter",
  "Bottom flip", "bottom flip", "Cutter 교체", "cutter 교체",
  "Sepa Run", "sepa run", "JXT",  // JXT는 lot ID prefix
  "Line PM", "line pm", "PM 일정", "pm 일정",
  "1AB", "1-AB", "Stacking 1", "stacking 1",
  "CPC 이상", "cpc 이상", "CPC monitoring", "cpc monitoring",
  "Stack vision", "stack vision", "F/I check", "f/i check",
];

// 명세서 §5.2 키워드 가중치 매트릭스 (점수 보너스)
const SCORE_KEYWORD_MATRIX = {
  safety_env: {
    bonus: 10,
    keywords: ["emergency", "EMO", "safety", "환경", "부상", "사고", "화재",
               "감전", "추락", "응급", "구급", "injury", "fire",
               "누유", "누수", "유출", "분진", "악취", "spill"],  // 영역 12-X1: 영문 leak 제외 (AZS 단순 공압 LEAK)
    fields: ["problem", "cause"],
  },
  quality_critical: {
    bonus: 7,
    keywords: ["NG", "defect", "품질", "vision NG"],
    fields: ["problem", "alarm"],
  },
  full_stop: {
    bonus: 5,
    keywords: ["full_stop"],
    fields: ["stop_status"],
  },
  unresolved: {
    bonus: 5,
    keywords: ["OPEN", "ToBeInformedLater", "monitoring", "not solved", "unsolved"],
    fields: ["duration", "status", "result"],
  },
  spare_missing: {
    bonus: 3,
    keywords: ["no spare", "spare 없음", "spare 부족"],
    fields: ["action"],
  },
};

// 명세서 §4.3: High Frequency 원인 카테고리 키워드 매트릭스 (부록 A)
const CAUSE_CATEGORIES = {
  ejector_suction: ["ejector", "suction", "vacuum", "PnP fail"],
  sensor: ["sensor", "limit", "detection", "cable loose"],
  servo: ["servo", "fault code", "over run", "31137"],
  regulator_coil: ["regulator", "coil", "BMREG"],
  ng_tab: ["tab width", "tab fold", "tab widht"],
  heat_press: ["heat press", "heatpress", "pressure result"],
  hang_error: ["hang error", "magazine lifter"],
  pulling: ["pulling drag", "pulling grip"],
  mandrel: ["mandrel"],
  splicing: ["splice", "splicing"],
};
// 우선순위 (이중 카테고리화 방지) — 위에서 아래로 우선
const CAUSE_PRIORITY = ["ng_tab", "mandrel", "ejector_suction", "servo", "regulator_coil",
                        "heat_press", "hang_error", "pulling", "splicing", "sensor"];

// ─── 모델 설정 (Function이 model 파라미터 지원하도록 수정됨) ─────────────────────
const MODEL_FAST = "claude-haiku-4-5";       // 라우터/분류기
const MODEL_REASONING = "claude-sonnet-4-5"; // 본 논의/사회자

// ─── 페르소나 정의 (8종: Cell 3 + Elec 3 + 공통 FA/Vision) ────────────────────
const PERSONAS = {
  // ── Cell 공정 ──
  Cell_PE: {
    label: "Cell 생산", process: "Cell",
    color: "#3b82f6", bg: "rgba(59,130,246,0.12)", icon: "🔵",
    role: "PE (Production Engineer) - Cell 공정",
    priority: "생산목표 달성(무리한 가동 지양) → 작업자 안전 → SOP → 납기",
    focus: "일일/주간 생산목표, 가동률, 작업자 숙련도, SOP, 자재 공급",
    stance: "TE의 임시조치/근본조치 요구에 적극 협조 (가동정지 감수 가능). ME 정비 시간과 일정 조율. 안전·품질 앞에서는 가동 고집 금지.",
  },
  Cell_ME: {
    label: "Cell 설비", process: "Cell",
    color: "#f97316", bg: "rgba(249,115,22,0.12)", icon: "🟠",
    role: "ME (Maintenance Engineer) - Cell 공정",
    priority: "설비 신뢰성(MTBF·MTTR) → 예지보전 → 설비 수명 → 정비비용",
    focus: "BM 빈도/패턴, 설비 노후도, 부품 수명, 진동·온도·소음, 예비부품",
    stance: "TE 원인 분석에 설비 데이터/이력으로 적극 협력. PE 가동요구 시 설비 부하 한계 명시.",
  },
  Cell_TE: {
    label: "Cell 기술 ★", process: "Cell",
    color: "#22d3ee", bg: "rgba(34,211,238,0.12)", icon: "🟢",
    role: "TE (Technical Engineer) - Cell 공정 — 근본원인 규명 주도자",
    priority: "수율 개선(가장 중요) → 불량 발생 공정 신속 규명 → RCA 임시/항구 대책 → Cpk 안정화",
    focus: "불량 패턴, 공정 변수(온도·압력·속도), 수율 추이, Cpk, 유사 불량 이력",
    stance: "이슈 발생 시 ① 어느 공정에서 발생했는지 진단 ② 임시조치/근본조치 구분 제시 ③ 데이터 근거 제시. PE/ME는 TE 진단을 우선 검토.",
  },
  // ── Elec 공정 ──
  Elec_PE: {
    label: "Elec 생산", process: "Elec",
    color: "#60a5fa", bg: "rgba(96,165,250,0.12)", icon: "🔷",
    role: "PE (Production Engineer) - Elec 공정",
    priority: "생산목표 달성(무리한 가동 지양) → 작업자 안전 → SOP → 납기",
    focus: "Elec 공정의 일일/주간 생산목표, 가동률, 작업자 숙련도, SOP, 자재 공급",
    stance: "TE의 임시조치/근본조치 요구에 적극 협조. ME 정비 시간과 일정 조율. 안전·품질 앞에서는 가동 고집 금지.",
  },
  Elec_ME: {
    label: "Elec 설비", process: "Elec",
    color: "#fb923c", bg: "rgba(251,146,60,0.12)", icon: "🟧",
    role: "ME (Maintenance Engineer) - Elec 공정",
    priority: "설비 신뢰성(MTBF·MTTR) → 예지보전 → 설비 수명 → 정비비용",
    focus: "Elec 설비 BM 빈도/패턴, 노후도, 부품 수명, 진동·온도·소음, 예비부품",
    stance: "TE 원인 분석에 설비 데이터/이력으로 적극 협력. PE 가동요구 시 설비 부하 한계 명시.",
  },
  Elec_TE: {
    label: "Elec 기술 ★", process: "Elec",
    color: "#67e8f9", bg: "rgba(103,232,249,0.12)", icon: "🟦",
    role: "TE (Technical Engineer) - Elec 공정 — 근본원인 규명 주도자",
    priority: "수율 개선(가장 중요) → 불량 발생 공정 신속 규명 → RCA 임시/항구 대책 → Cpk 안정화",
    focus: "Elec 공정 불량 패턴, 공정 변수, 수율 추이, Cpk, 유사 불량 이력",
    stance: "이슈 발생 시 ① 어느 공정에서 발생했는지 진단 ② 임시조치/근본조치 구분 제시 ③ 데이터 근거 제시. PE/ME는 TE 진단을 우선 검토.",
  },
  // ── 공통 (Cell/Elec 모두 지원) ──
  FA: {
    label: "FA (반송)", process: "공통",
    color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "🟣",
    role: "FA (Factory Automation) Engineer — 자동 반송 시스템 (전 공정 공통)",
    priority: "반송 흐름 안정성 → 반송 설비 가동률 → WIP 적정 수준 → MES/PLC 연동",
    focus: "C/V 잼·정렬, Stocker 처리능력, OHT 충돌·경로, AGV 배터리·통신, MES 통신, WIP 누적, 반송 중 손상",
    stance: "이슈가 공정인가 반송인가 검토. TE 분석 시 반송 중 발생 가능성(낙하·충격·대기) 제시.",
  },
  Vision: {
    label: "Vision (검사)", process: "공통",
    color: "#ec4899", bg: "rgba(236,72,153,0.12)", icon: "🔴",
    role: "Vision Engineer — 외관검사 (전 공정 공통)",
    priority: "외관 불량 검출 정확도 → Vision 시스템 안정성 → 알고리즘 최적화 → 신규 불량 모드 학습",
    focus: "검사 통과율, 오검/미검률, 조명·카메라 컨디션, 신규 불량 패턴, 검사 기준",
    stance: "검출 정확도 관점에서 의견. 오검·미검 가능성, 신규 불량 모드 여부 검토.",
  },
};

// ─── 공정 정의 ─────────────────────────────────────────────────────────────────
const PROCESSES = {
  Cell: {
    label: "Cell 공정",
    icon: "🔵",
    auto: ["Cell_PE", "Cell_ME", "Cell_TE"],
    otherProcess: "Elec",
  },
  Elec: {
    label: "Elec 공정",
    icon: "🔷",
    auto: ["Elec_PE", "Elec_ME", "Elec_TE"],
    otherProcess: "Cell",
  },
};

const COMMON_AGENTS = ["FA", "Vision"];

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

async function loadSelectedKnowledge(agentCodes) {
  // 선택된 에이전트의 학습 데이터만 로드 (효율)
  // ★ 페르소나 코드 → Apps Script TAB_MAP 키 매핑
  // FA, Vision은 그대로, Cell_*/Elec_*도 그대로
  const results = await Promise.allSettled(agentCodes.map(c => loadKnowledge(c)));
  const kb = {};
  const stats = { failed: 0 };
  agentCodes.forEach((code, i) => {
    const r = results[i];
    if (r.status === "fulfilled") {
      kb[code] = r.value;
      stats[code] = r.value ? r.value.split("\n").filter(Boolean).length : 0;
    } else {
      kb[code] = "";
      stats[code] = 0;
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
  // ★ 영역 9-A: 두 시간 형식 지원
  //  (1) 24시간: "24/2/8 16:15 - 손영희: ..."
  //  (2) AM/PM 한글 로케일: "24/2/8 PM 4:15 - ..." 또는 "24/2/8 오후 4:15 - ..."
  const msgRe24   = /^(\d{2}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+-\s+([^:]+):\s*(.*)/;
  const msgReAmPm = /^(\d{2}\/\d{1,2}\/\d{1,2})\s+(AM|PM|오전|오후)\s+(\d{1,2}):(\d{2})\s+-\s+([^:]+):\s*(.*)/;

  // AM/PM → 24시간 변환
  const to24h = (ampm, h, mm) => {
    let hour = parseInt(h, 10);
    const isPM = ampm === "PM" || ampm === "오후";
    const isAM = ampm === "AM" || ampm === "오전";
    if (isPM && hour < 12) hour += 12;
    else if (isAM && hour === 12) hour = 0;
    return { time: `${hour}:${mm}`, hour };
  };

  const msgs = [];
  let cur = null;
  for (const line of lines) {
    let m = line.match(msgRe24);
    if (m) {
      if (cur) msgs.push(cur);
      cur = { date: m[1], time: m[2], hour: parseInt(m[2].split(":")[0], 10), sender: m[3].trim(), text: m[4] };
      continue;
    }
    m = line.match(msgReAmPm);
    if (m) {
      if (cur) msgs.push(cur);
      const { time, hour } = to24h(m[2], m[3], m[4]);
      cur = { date: m[1], time, hour, sender: m[5].trim(), text: m[6] };
      continue;
    }
    if (cur && line.trim()) {
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

// ─── 영역 8-A: 생산일자(YY/M/D) ↔ Date 객체 변환 + 주/월 그룹핑 헬퍼 ─────────────
// 생산일자 룰: 시작일자 06:00 ~ 종료일자+1일 06:00 (getProductionDate와 일치)
function dateStrToDate(dateStr) {
  const parts = dateStr.split("/").map(Number);
  return new Date(2000 + parts[0], parts[1] - 1, parts[2]);
}
function dateToDateStr(d) {
  return `${String(d.getFullYear()).slice(-2)}/${d.getMonth() + 1}/${d.getDate()}`;
}
function isoToDateStr(iso) {
  // "2026-04-13" → "26/4/13"
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(y).slice(-2)}/${m}/${d}`;
}
function dateStrToIso(dateStr) {
  const parts = dateStr.split("/").map(Number);
  const yyyy = 2000 + parts[0];
  const mm = String(parts[1]).padStart(2, "0");
  const dd = String(parts[2]).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
// 시작/끝 생산일자 → 그 사이의 모든 생산일자 배열
function expandRange(startStr, endStr) {
  const s = dateStrToDate(startStr);
  const e = dateStrToDate(endStr);
  if (e < s) return [];
  const result = [];
  for (let cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
    result.push(dateToDateStr(cur));
  }
  return result;
}
// 주어진 생산일자가 속한 ISO week (월요일~일요일) 정보
function getWeekInfo(dateStr) {
  const d = dateStrToDate(dateStr);
  const day = d.getDay(); // 0=일, 1=월, ...
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  // 4월 N주차 라벨: 그 주 목요일이 속한 월의 N주차로 계산 (ISO 표준)
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const month = thursday.getMonth() + 1;
  const year = thursday.getFullYear();
  // 해당 월의 첫 목요일 → 1주차
  const firstThu = new Date(year, month - 1, 1);
  while (firstThu.getDay() !== 4) firstThu.setDate(firstThu.getDate() + 1);
  const weekNo = Math.floor((thursday.getDate() - firstThu.getDate()) / 7) + 1;
  return {
    start: dateToDateStr(monday),
    end: dateToDateStr(sunday),
    label: `${year}년 ${month}월 ${weekNo}주차`,
    key: `${year}-${String(month).padStart(2, "0")}-W${weekNo}`,
  };
}
// 주어진 일자 범위에 포함된 모든 주 정보 (중복 제거)
function getWeeksInRange(startStr, endStr) {
  const dates = expandRange(startStr, endStr);
  const map = new Map();
  for (const d of dates) {
    const w = getWeekInfo(d);
    if (!map.has(w.key)) map.set(w.key, w);
  }
  return Array.from(map.values());
}
// 주어진 일자 범위에 포함된 모든 월 정보 (중복 제거)
function getMonthsInRange(startStr, endStr) {
  const s = dateStrToDate(startStr);
  const e = dateStrToDate(endStr);
  const map = new Map();
  for (let cur = new Date(s.getFullYear(), s.getMonth(), 1); cur <= e; cur.setMonth(cur.getMonth() + 1)) {
    const y = cur.getFullYear();
    const m = cur.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    map.set(key, {
      year: y, month: m, label: `${y}년 ${m}월`, key,
      // 그 월의 모든 일자 (해당 범위 내)
      dates: [],
    });
  }
  // 각 월에 속한 생산일자 채워넣기
  for (const dateStr of expandRange(startStr, endStr)) {
    const parts = dateStr.split("/").map(Number);
    const key = `${2000 + parts[0]}-${String(parts[1]).padStart(2, "0")}`;
    if (map.has(key)) map.get(key).dates.push(dateStr);
  }
  return Array.from(map.values());
}
// 빠른 선택 프리셋 (오늘 / 어제 / 이번 주 / 지난 주 / 이번 달 / 지난 달 / 최근 7일 / 최근 30일)
// 모두 "생산일자" 기준 (06시 룰 적용은 메시지 필터 단계에서 처리)
function getQuickRange(preset, todayDateStr) {
  const today = dateStrToDate(todayDateStr);
  const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay(); // 월=1,...,일=7
  const helpers = {
    "today":      () => [todayDateStr, todayDateStr],
    "yesterday":  () => {
      const y = new Date(today); y.setDate(today.getDate() - 1);
      const ys = dateToDateStr(y);
      return [ys, ys];
    },
    "thisWeek":   () => {
      const mon = new Date(today); mon.setDate(today.getDate() - (dayOfWeek - 1));
      return [dateToDateStr(mon), todayDateStr];
    },
    "lastWeek":   () => {
      const mon = new Date(today); mon.setDate(today.getDate() - (dayOfWeek - 1) - 7);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return [dateToDateStr(mon), dateToDateStr(sun)];
    },
    "thisMonth":  () => {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return [dateToDateStr(first), todayDateStr];
    },
    "lastMonth":  () => {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last  = new Date(today.getFullYear(), today.getMonth(), 0);
      return [dateToDateStr(first), dateToDateStr(last)];
    },
    "last7":      () => {
      const s = new Date(today); s.setDate(today.getDate() - 6);
      return [dateToDateStr(s), todayDateStr];
    },
    "last30":     () => {
      const s = new Date(today); s.setDate(today.getDate() - 29);
      return [dateToDateStr(s), todayDateStr];
    },
  };
  return helpers[preset] ? helpers[preset]() : null;
}

// ─── 영역 11-J: 06시 생산일자 룰 기반 분석 기간 라벨 ─────────────────────────
// 예: ["26/4/28"] → "2026년 4월 28일 06:00 ~ 4월 29일 06:00"
function buildProductionRangeLabel(selDates) {
  if (!selDates || selDates.length === 0) return "";
  const sorted = [...selDates].sort();
  const startStr = sorted[0];
  const endStr = sorted[sorted.length - 1];

  const startD = dateStrToDate(startStr);
  const endD = dateStrToDate(endStr);
  const endNext = new Date(endD);
  endNext.setDate(endNext.getDate() + 1);

  const fmt = (d, includeYear = false) => {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return includeYear ? `${y}년 ${m}월 ${day}일` : `${m}월 ${day}일`;
  };

  const sameYear = startD.getFullYear() === endNext.getFullYear();
  const startLabel = fmt(startD, true);
  const endLabel = fmt(endNext, !sameYear);
  const hours = Math.round((endNext - startD) / (1000 * 60 * 60));
  const days = sorted.length;

  return `${startLabel} 06:00 ~ ${endLabel} 06:00 (${days}일, 약 ${hours}시간)`;
}

// 보고서 헤더용 라벨 빌더
function buildRangeLabel(selRange) {
  if (!selRange || !selRange.start || !selRange.end) return "";
  const { start, end, unit } = selRange;
  if (unit === "month") {
    const months = getMonthsInRange(start, end);
    if (months.length === 1) return `${months[0].label} (월간)`;
    if (months.length > 1) return `${months[0].label} ~ ${months[months.length-1].label} (${months.length}개월)`;
  }
  if (unit === "week") {
    const weeks = getWeeksInRange(start, end);
    if (weeks.length === 1) return `${weeks[0].label} (주간)`;
    if (weeks.length > 1) return `${weeks[0].label} ~ ${weeks[weeks.length-1].label} (${weeks.length}주)`;
  }
  // day 단위
  if (start === end) return `${start} (1일)`;
  const days = expandRange(start, end).length;
  return `${start} ~ ${end} (${days}일)`;
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

// ★ 영역 12-AD1: 키워드 정밀 매칭 — 짧은 영문 약어는 단어 경계 강제
// 버그 사례: "NG" 키워드가 "tuangan", "barang", "yang" 등 인도네시아어/일반 단어 안의 "ng" 부분문자열에 잘못 매칭됨
// 해결: 영문/숫자만으로 구성된 짧은 키워드(1~3자)는 \b 단어 경계로 매칭, 긴 키워드/한글은 부분문자열 그대로
function matchKeyword(text, kw) {
  const lowerKw = (kw || "").toLowerCase();
  if (!lowerKw) return false;
  const lowerText = (text || "").toLowerCase();
  // 짧은 영문/숫자 약어 (1~3자) → 단어 경계 강제
  if (lowerKw.length <= 3 && /^[a-z0-9]+$/.test(lowerKw)) {
    const escaped = lowerKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    return re.test(text);
  }
  // 긴 키워드 또는 한글/특수문자 포함 → 부분문자열 매칭 (기존 로직)
  return lowerText.includes(lowerKw);
}

function classifyMessages(msgs) {
  const downtime = [], equipment = [], general = [];
  // 영역 5: 큐레이션 이력 카테고리
  const qualityMsgs = [], processChangeMsgs = [], testMsgs = [], ambiguousMsgs = [];

  // ★ 영역 12-AC2: 안전망용 — 옛 형식 흡수된 sub-message 키워드 분류 헬퍼
  const classifySubMessage = (subText, baseEntry) => {
    if (!subText || subText.trim().length <= 5) return;
    if (subText.includes("미디어 파일 제외됨")) return;
    const matched = [];
    // ★ 12-AD1: matchKeyword (단어 경계 강제)
    if (QUALITY_KEYWORDS.some(kw => matchKeyword(subText, kw))) matched.push("quality");
    if (PROCESS_CHANGE_KEYWORDS.some(kw => matchKeyword(subText, kw))) matched.push("process_change");
    if (TEST_KEYWORDS.some(kw => matchKeyword(subText, kw))) matched.push("test");
    // 패턴 매칭
    if (!matched.includes("process_change")) {
      const settingPattern = /\d+(?:\.\d+)?\s*(?:→|->|=>|>>)\s*\d+(?:\.\d+)?/;
      if (settingPattern.test(subText)) matched.push("process_change");
    }
    if (!matched.includes("quality")) {
      const jxtPattern = /JXT\d{10,}/i;
      if (jxtPattern.test(subText)) matched.push("quality");
    }
    const subEntry = { ...baseEntry, text: subText };
    if (matched.length === 1) {
      if (matched[0] === "quality") qualityMsgs.push(subEntry);
      else if (matched[0] === "process_change") processChangeMsgs.push(subEntry);
      else if (matched[0] === "test") testMsgs.push(subEntry);
    } else if (matched.length >= 2) {
      ambiguousMsgs.push({ ...subEntry, matched });
    }
  };

  let absorbedSubCount = 0;  // 12-AC2 진단용
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m.text.includes("[BM Downtime Bot]")) {
      let full = m.text;

      // ★ 영역 12-AC1: 신 형식 BM Bot 감지 — Start Time / End Time이 모두 있으면 단일 메시지로 완결됨
      // 옛 형식 (~2025): 한 메시지가 여러 줄로 분리됨 → multi-line 통합 필요
      // 신 형식 (2026~): 한 메시지에 모든 필드 포함 → 통합 시 일반 메시지 흡수 부작용
      const hasCompleteFields = m.text.includes("Start Time") && m.text.includes("End Time");

      if (!hasCompleteFields) {
        // 옛 형식 — multi-line 통합 (기존 로직 + 12-AC2 안전망)
        let j = i + 1;
        const absorbedTexts = [];  // 흡수된 sub-message 보관 (안전망)
        while (j < msgs.length && !msgs[j].text.includes("[BM Downtime Bot]")) {
          if (!msgs[j].text.includes("미디어 파일 제외됨")) {
            full += "\n" + msgs[j].text;
            absorbedTexts.push({ text: msgs[j].text, msg: msgs[j] });  // 흡수 시 보관
          }
          j++;
          if (j - i > 15) break;
        }
        downtime.push({ time: m.time, text: full, date: m.date, hour: m.hour });

        // ★ 12-AC2: 흡수된 sub-message 각각도 키워드 매칭 별도 실행 (PM/조건변경 누락 방지)
        absorbedTexts.forEach(({ text, msg }) => {
          classifySubMessage(text, {
            time: msg.time, sender: msg.sender, date: msg.date, hour: msg.hour,
          });
          absorbedSubCount++;
        });

        i = j;
      } else {
        // ★ 12-AC1: 신 형식 — 단일 메시지로 처리, 다음 일반 메시지 흡수 안 함
        downtime.push({ time: m.time, text: full, date: m.date, hour: m.hour });
        i++;
      }
    } else if (m.text.match(/cutter|limit|⚠️|🟡|cathode|anode/i)) {
      equipment.push({ time: m.time, sender: m.sender, text: m.text, date: m.date, hour: m.hour });
      i++;
    } else {
      if (m.text.trim().length > 5) general.push({ time: m.time, sender: m.sender, text: m.text, date: m.date, hour: m.hour });
      i++;
    }

    // ── 영역 5: 다운타임이 아닌 메시지에 대해 큐레이션 카테고리 키워드 매칭 ──
    // (다운타임 메시지는 j까지 점프했으므로 위에서 분류되고 여기는 돌아오지 않음)
    if (m.text.includes("[BM Downtime Bot]")) continue;
    if (m.text.trim().length <= 5) continue;
    if (m.text.includes("미디어 파일 제외됨")) continue;

    const matched = [];
    // ★ 12-AD1: matchKeyword (단어 경계 강제) — "ng" 부분문자열 오매칭 차단
    if (QUALITY_KEYWORDS.some(kw => matchKeyword(m.text, kw))) matched.push("quality");
    if (PROCESS_CHANGE_KEYWORDS.some(kw => matchKeyword(m.text, kw))) matched.push("process_change");
    if (TEST_KEYWORDS.some(kw => matchKeyword(m.text, kw))) matched.push("test");

    // ★ 영역 12-AB3: 패턴 매칭 — "숫자 → 숫자" 또는 "숫자->숫자" 패턴 발견 시 process_change 자동 분류
    // 예: "39.6 → 40.0", "70.2 -> 70.6", "180 → 200"
    if (!matched.includes("process_change")) {
      const settingPattern = /\d+(?:\.\d+)?\s*(?:→|->|=>|>>)\s*\d+(?:\.\d+)?/;
      if (settingPattern.test(m.text)) {
        matched.push("process_change");
      }
    }

    // ★ 영역 12-AB3: JXT lot ID 패턴 (예: JXT11251121022J66103) — quality 자동 분류
    if (!matched.includes("quality")) {
      const jxtPattern = /JXT\d{10,}/i;
      if (jxtPattern.test(m.text)) {
        matched.push("quality");
      }
    }

    const entry = { time: m.time, sender: m.sender, text: m.text, date: m.date, hour: m.hour };

    if (matched.length === 1) {
      // 1개 카테고리만 매칭 → 직접 할당
      if (matched[0] === "quality") qualityMsgs.push(entry);
      else if (matched[0] === "process_change") processChangeMsgs.push(entry);
      else if (matched[0] === "test") testMsgs.push(entry);
    } else if (matched.length >= 2) {
      // 2개 이상 카테고리에 걸침 → 모호 (AI 분류 대상, 5-C에서 처리)
      ambiguousMsgs.push({ ...entry, matched });
    } else {
      // matched.length === 0 → general 배열에만 남음 (AI 비용 절약)
      general.push(entry);
    }
  }
  // ★ 영역 12-AB4 + 12-AC2: 분류 안 된 일반 메시지 진단 로그
  if (typeof console !== "undefined") {
    if (absorbedSubCount > 0) {
      console.log(`[메시지 분류] 옛 형식 BM Bot이 흡수한 sub-message ${absorbedSubCount}건도 키워드 분류 별도 실행 (12-AC2)`);
    }
    if (general.length > 0) {
      console.log(`[메시지 분류 진단] 분류 안 됨(general) ${general.length}건. 샘플 5건 (3,4번 누락 진단용):`);
      general.slice(0, 5).forEach((g, i) => {
        const preview = (g.text || "").replace(/\n/g, " ").slice(0, 150);
        console.log(`  [${i+1}] ${g.sender || "?"}: ${preview}${g.text.length > 150 ? "..." : ""}`);
      });
    }
    if (processChangeMsgs.length === 0 && testMsgs.length === 0 && general.length > 5) {
      console.warn(`[⚠️ 분류 경고] process_change/test 모두 0건 — 키워드 매칭 부족 가능. 위 general 샘플 확인 필요`);
    }
  }
  return { downtime, equipment, general, qualityMsgs, processChangeMsgs, testMsgs, ambiguousMsgs };
}

// ─── 영역 5-C: 모호 메시지 AI 분류 (2개 이상 카테고리에 걸친 메시지만 Haiku 호출) ──
async function classifyAmbiguousMessages(ambiguousMsgs) {
  if (!ambiguousMsgs || ambiguousMsgs.length === 0) {
    return { quality: [], process_change: [], test: [], skip: [] };
  }

  const sys = `당신은 공장 메시지 분류기입니다. 각 메시지를 다음 카테고리 중 하나로 정확히 분류하세요:
- quality: 품질 이슈 (불량, NG, 수율, 외관 등 결과 측면)
- process_change: 설비/공정 조건 변경 (recipe/setpoint/gap/온도/속도 등 셋팅 변경)
- test: 테스트/양산외 생산 (DOE, trial, 시험, 샘플 등)
- skip: 위 어디에도 명확히 해당하지 않음

여러 카테고리에 걸쳐 있다면 메시지의 주된 의도를 보고 1개만 선택하세요.
출력은 JSON 객체만, 다른 텍스트 금지.`;

  const userMsg = `[모호 메시지 ${ambiguousMsgs.length}건]
${ambiguousMsgs.map((m, i) => `${i + 1}. ${m.text.slice(0, 200).replace(/\n/g, " ")}`).join("\n")}

다음 형식으로 출력 (메시지 번호와 카테고리):
{"items":[{"no":1,"category":"quality"},{"no":2,"category":"process_change"}]}`;

  try {
    const raw = await callClaudeRaw(sys, userMsg, { model: MODEL_FAST, max_tokens: 1500 });
    const parsed = safeJSON(raw);
    const result = { quality: [], process_change: [], test: [], skip: [] };
    if (Array.isArray(parsed.items)) {
      parsed.items.forEach(item => {
        const idx = (item.no || 0) - 1;
        const cat = item.category;
        if (idx >= 0 && idx < ambiguousMsgs.length && result[cat]) {
          result[cat].push(ambiguousMsgs[idx]);
        }
      });
    }
    return result;
  } catch (e) {
    console.error("[모호 메시지 AI 분류 실패]", e);
    // 폴백: 모호 메시지를 첫 매칭 카테고리에 자동 할당
    const result = { quality: [], process_change: [], test: [], skip: [] };
    ambiguousMsgs.forEach(m => {
      const first = m.matched?.[0];
      if (first === "quality") result.quality.push(m);
      else if (first === "process_change") result.process_change.push(m);
      else if (first === "test") result.test.push(m);
      else result.skip.push(m);
    });
    return result;
  }
}

// ─── 영역 11-A: 다운타임 → 모든 이슈 추출 (priority 분류 폐기) ─────────────────
// 기존 classifyPriority/scoreIssue/selectKeyIssues는 영역 11에서 폐기됨.
// 모든 이슈는 동등하게 추출되고, tags(LONG_DOWNTIME/HIGH_FREQUENCY/...)로만 분류.
// 자동 선정 = LONG_DOWNTIME 또는 HIGH_FREQUENCY tag 보유.
// 사용자 추가 = STEP 3 체크박스로 자유롭게 선택.
// ─── 영역 6: 이슈 안정 ID (체크박스 추적용) — 모듈 최상위 (모든 컴포넌트 공유) ─
function getIssueId(issue) {
  return `${issue.date || "?"}_${issue.time || "?"}_${issue.eq || "?"}_${(issue.prob || "").slice(0, 20)}`;
}

function extractAllIssues(downtime) {
  const equipCount = {}, partCount = {}, alarmCount = {};
  // 사전 카운트 (반복 횟수 계산용)
  downtime.forEach(d => {
    const eq = extractField(d.text, "Equipment");
    const part = extractField(d.text, "Part Replacement");
    const alarmMatch = (d.text || "").match(/\*?Alarm\*?\s*[:：]\s*([^\n]+)/i);
    const alarm = alarmMatch ? alarmMatch[1].trim() : "";
    if (eq) equipCount[eq] = (equipCount[eq] || 0) + 1;
    if (part && part !== "-" && part.length > 2) partCount[part] = (partCount[part] || 0) + 1;
    if (alarm) alarmCount[alarm] = (alarmCount[alarm] || 0) + 1;
  });

  return downtime.map(d => {
    const result = extractField(d.text, "Result");
    const durStr = extractField(d.text, "Duration");
    let durMin = parseInt(durStr) || 0;

    // ★ 영역 12-AA: 신 형식 BM Bot 지원 — Duration 필드 없을 때 Start Time / End Time으로 계산
    // 옛 형식 (~2025): *Duration*: 7 minutes
    // 신 형식 (2026~): *Start Time*: 8/11/2025, 2:48:10 PM / *End Time*: 8/11/2025, 3:00:10 PM
    if (durMin === 0) {
      const startStr = extractField(d.text, "Start Time");
      const endStr = extractField(d.text, "End Time");
      if (startStr && endStr) {
        try {
          const startDate = new Date(startStr);
          const endDate = new Date(endStr);
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            const diffMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
            if (diffMin > 0 && diffMin < 24 * 60 * 7) {  // 0~1주일 사이만 유효 (방어)
              durMin = diffMin;
            }
          }
        } catch (e) {
          // 파싱 실패 시 0 유지
        }
      }
    }

    const stopStatus = extractField(d.text, "Stop Status");
    const eq = extractField(d.text, "Equipment");
    const part = extractField(d.text, "Part Replacement");
    const prob = extractField(d.text, "Problem");
    const cause = extractField(d.text, "Cause");
    const action = extractField(d.text, "Action");
    const pic = extractField(d.text, "PIC");
    const alarmMatch = (d.text || "").match(/\*?Alarm\*?\s*[:：]\s*([^\n]+)/i);
    const alarm = alarmMatch ? alarmMatch[1].trim() : "";
    const repeatCount = Math.max(
      eq ? (equipCount[eq] || 1) : 1,
      (part && part !== "-" && part.length > 2) ? (partCount[part] || 1) : 1,
    );
    return {
      ...d,
      eq, prob, cause, result, action, pic, durMin,
      stopStatus, repeatCount, _alarm: alarm,
      reasons: [],
    };
  });
}

// 점수 계산 (영역 11 기본 점수 함수 — 기존 scoreIssue 대체)
// scoreIssueMatrix는 그대로 활용 (영역 9-C에 이미 정의됨).
// 자동 선정 시 점수 내림차순으로 정렬 후 TOP MAX_ISSUES.
function selectKeyIssuesV2(taggedIssues, maxIssues = MAX_ISSUES) {
  const candidates = taggedIssues.filter(i =>
    i.tags.includes("LONG_DOWNTIME") || i.tags.includes("HIGH_FREQUENCY")
  );
  const scored = candidates.map(issue => {
    const s = scoreIssueMatrix(issue);
    return { ...issue, score: s.total, scoreBreakdown: s.breakdown };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.durMin || 0) - (a.durMin || 0);
  });
  return scored.slice(0, maxIssues);
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ 영역 9 (PoC) ★ 명세서 기반 5-카테고리 분류 + 다중 tags + 매트릭스 점수
// ═════════════════════════════════════════════════════════════════════════════

// ─── 9-B: 5-카테고리 분류 (명세서 §4) ───────────────────────────────────────
// 한 이슈가 여러 카테고리(tags)에 속할 수 있음.
// 입력: classifyPriority가 반환한 priority 객체 (urgent/important/normal 모두 활용)
// 출력: 모든 이슈에 tags: [] 부착 + 카운트 정보
// 입력: 평면 배열 (영역 11) 또는 priority 객체 (하위호환)
function classifyIssues5Category(input, options = {}) {
  const { longDowntimeThresholdMin = 60, repeatThreshold = 2 } = options;
  const allIssues = Array.isArray(input)
    ? input
    : [...(input.urgent || []), ...(input.important || []), ...(input.normal || [])];

  // (a) 설비별 카운트 (HIGH_FREQUENCY 판정용)
  const eqCounts = {};
  for (const i of allIssues) {
    const eq = i.eq || "";
    if (eq) eqCounts[eq] = (eqCounts[eq] || 0) + 1;
  }
  // (b) 알람별 카운트
  const alarmCounts = {};
  for (const i of allIssues) {
    // alarm 필드: extractAllIssues가 _alarm 캐싱 → 우선 사용. 없으면 text에서 추출
    let alarm = i._alarm || "";
    if (!alarm) {
      const alarmMatch = (i.text || "").match(/\*?Alarm\*?\s*[:：]\s*([^\n]+)/i);
      alarm = alarmMatch ? alarmMatch[1].trim() : "";
      i._alarm = alarm;
    }
    if (alarm) alarmCounts[alarm] = (alarmCounts[alarm] || 0) + 1;
  }
  // (c) 원인 카테고리 매칭 (이중 방지: CAUSE_PRIORITY 순서대로)
  const matchCauseCategory = (issue) => {
    const text = [issue.eq, issue.prob, issue.cause, issue.result, issue.text || ""]
      .join(" ").toLowerCase();
    for (const cat of CAUSE_PRIORITY) {
      const kws = CAUSE_CATEGORIES[cat] || [];
      if (kws.some(kw => text.includes(kw.toLowerCase()))) return cat;
    }
    return null;
  };

  // 각 이슈에 tags 부착
  const tagged = allIssues.map(issue => {
    const tags = [];
    const fullText = [issue.eq, issue.prob, issue.cause, issue.result, issue.text || ""]
      .join(" ").toLowerCase();

    // LONG_DOWNTIME: 부동시간 ≥ threshold 또는 미해결
    const isUnsolved = (issue.result || "").toLowerCase().match(/not solved|unsolved/) ||
                       (issue.reasons || []).some(r => r.includes("미해결"));
    if ((issue.durMin || 0) >= longDowntimeThresholdMin || isUnsolved) {
      tags.push("LONG_DOWNTIME");
    }

    // HIGH_FREQUENCY: 동일 설비 N회+ 또는 동일 알람 N회+
    const eq = issue.eq || "";
    const alarm = issue._alarm || "";
    if ((eq && eqCounts[eq] >= repeatThreshold) ||
        (alarm && alarmCounts[alarm] >= repeatThreshold)) {
      tags.push("HIGH_FREQUENCY");
    }

    // CONDITION_CHANGE: parameter change 패턴 (명세서 §10.2)
    if (PROCESS_CHANGE_KEYWORDS.some(kw => fullText.includes(kw.toLowerCase())) ||
        /(\d+(?:\.\d+)?)\s*(?:to|→|->|에서)\s*(\d+(?:\.\d+)?)/i.test(fullText)) {
      tags.push("CONDITION_CHANGE");
    }

    // TEST_PM: 테스트 키워드
    if (TEST_KEYWORDS.some(kw => fullText.includes(kw.toLowerCase()))) {
      tags.push("TEST_PM");
    }

    // QUALITY_NG: 품질 키워드
    if (QUALITY_KEYWORDS.some(kw => fullText.includes(kw.toLowerCase()))) {
      tags.push("QUALITY_NG");
    }

    // 원인 카테고리 (서브 분류)
    const causeCategory = matchCauseCategory(issue);

    return { ...issue, tags, causeCategory };
  });

  // 카테고리별 카운트
  const counts = {
    LONG_DOWNTIME: tagged.filter(i => i.tags.includes("LONG_DOWNTIME")).length,
    HIGH_FREQUENCY: tagged.filter(i => i.tags.includes("HIGH_FREQUENCY")).length,
    CONDITION_CHANGE: tagged.filter(i => i.tags.includes("CONDITION_CHANGE")).length,
    TEST_PM: tagged.filter(i => i.tags.includes("TEST_PM")).length,
    QUALITY_NG: tagged.filter(i => i.tags.includes("QUALITY_NG")).length,
    UNTAGGED: tagged.filter(i => i.tags.length === 0).length,
  };

  return { issues: tagged, counts, eqCounts, alarmCounts };
}

// ─── 9-C: 명세서 §5.2 매트릭스 기반 점수 (기존 scoreIssue 대체) ─────────────────
// 기존 scoreIssue와 호환되는 시그니처. 명세서 키워드 매트릭스 5종 적용.
function scoreIssueMatrix(issue) {
  const dur = issue.durMin || 0;
  const breakdown = {
    downtime: dur / 30,
    repeat: ((issue.repeatCount || 1) >= 2) ? (issue.repeatCount * 3) : 0,
    // ★ 영역 12-X2 (6): 장기부동 별도 보너스 — 부동시간 누락 방지
    long_downtime_bonus: dur >= 60 ? 8 : 0,
    very_long_downtime_bonus: dur >= 120 ? 5 : 0,
  };

  // 매트릭스 5종 적용
  const fieldMap = {
    problem: issue.prob || "",
    cause: issue.cause || "",
    alarm: issue._alarm || "",
    stop_status: issue.stopStatus || ((issue.reasons || []).join(" ").includes("Full Stop") ? "full_stop" : ""),
    duration: issue.durMin == null ? "ToBeInformedLater" : "",
    status: issue.result || "",
    result: issue.result || "",
    action: issue.action || "",
  };

  for (const [key, def] of Object.entries(SCORE_KEYWORD_MATRIX)) {
    const text = (def.fields || []).map(f => fieldMap[f] || "").join(" ").toLowerCase();
    if (def.keywords.some(kw => text.includes(kw.toLowerCase()))) {
      breakdown[key] = def.bonus;
    } else {
      breakdown[key] = 0;
    }
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.round(total * 10) / 10, breakdown };
}

// ─── 9-B: 명세서 기반 신규 selectKeyIssues (LONG_DOWNTIME tag 기반) ────────────
function selectKeyIssuesFromTags(taggedIssues, maxIssues = MAX_ISSUES) {
  // LONG_DOWNTIME 또는 HIGH_FREQUENCY tag가 있는 이슈만 후보
  const candidates = taggedIssues.filter(i =>
    i.tags.includes("LONG_DOWNTIME") || i.tags.includes("HIGH_FREQUENCY")
  );
  const scored = candidates.map(issue => {
    const s = scoreIssueMatrix(issue);
    return { ...issue, score: s.total, scoreBreakdown: s.breakdown };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.durMin || 0) - (a.durMin || 0);
  });
  return scored.slice(0, maxIssues);
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ 새로운 논의 시스템 ★
// ═════════════════════════════════════════════════════════════════════════════

// ─── 0. PE 사전 큐레이션 — 영역 12-X3 (7): Sonnet 3분할 병렬 호출 ─────────────
// 각 호출 max_tokens 2000 / Sonnet (MODEL_REASONING) / 504 시 Haiku fallback
// Promise.all로 동시 실행 → 전체 시간 = 가장 느린 1건 (~8~10초)
async function runPreCuration(allIssues, kbPE, reportType, categoryMsgs = {}) {
  const qualityList = categoryMsgs.quality || [];
  const processChangeList = categoryMsgs.process_change || [];
  const testList = categoryMsgs.test || [];

  if (!allIssues || allIssues.length === 0) {
    return emptyBriefing();
  }

  // 이슈 데이터 변환
  const issuesData = allIssues.map((issue, idx) => ({
    no: idx + 1,
    date: issue.date || "",
    time: issue.time,
    equipment: issue.eq,
    problem: (issue.prob || "").slice(0, 150),
    cause: (issue.cause || "").slice(0, 150),
    action: (issue.action || "").slice(0, 200),
    result: (issue.result || "").slice(0, 100),
    pic: (issue.pic || "").slice(0, 60),
    duration_min: issue.durMin,
    stop_status: issue.stopStatus || "",
    alarm: (issue._alarm || "").slice(0, 100),
  }));

  const formatMsgs = (arr, max = 20) => arr.slice(0, max).map((m, i) => ({
    no: i + 1,
    date: m.date || "",
    time: m.time || "",
    sender: m.sender || "",
    text: (m.text || "").slice(0, 200).replace(/\n/g, " "),
  }));

  const qualityData = formatMsgs(qualityList);
  const processChangeData = formatMsgs(processChangeList);
  const testData = formatMsgs(testList);

  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const kbText = kbPE ? `\n\n[학습 내용 일부]\n${kbPE.slice(0, 300)}` : "";
  const isWeekly = reportType === "weekly";
  const longThreshold = isWeekly ? 60 : 30;

  // ★ 영역 12-AE2: quality 메시지도 Part 2b 입력에 추가 (STK-4-B3 같은 NG+setting 메시지 누락 방지)
  const qualityWithSetting = (categoryMsgs.quality || []).slice(0, 8).map((m, i) => ({
    no: i + 1,
    date: m.date || "",
    time: m.time || "",
    sender: m.sender || "",
    text: (m.text || "").slice(0, 350).replace(/\n/g, " | "),
  }));

  // ★ 영역 12-AG1: Part 2b 전용 long format — Setting 항목 풀 추출 위해 10건 × 800자
  // 기존 formatMsgs는 200자라 STK-3-B2 메시지 (1000자+)에서 Countermeasures 1~2개만 보임
  const formatMsgsLong = (arr, max = 10) => arr.slice(0, max).map((m, i) => ({
    no: i + 1,
    date: m.date || "",
    time: m.time || "",
    sender: m.sender || "",
    text: (m.text || "").slice(0, 800).replace(/\n/g, " | "),
  }));
  const processChangeDataLong = formatMsgsLong(processChangeList);
  const qualityWithSettingLong = (categoryMsgs.quality || []).slice(0, 8).map((m, i) => ({
    no: i + 1,
    date: m.date || "",
    time: m.time || "",
    sender: m.sender || "",
    text: (m.text || "").slice(0, 800).replace(/\n/g, " | "),
  }));
  // ★ 영역 12-AH1: Part 3 chronic1AB용 quality 메시지 long format (5건 × 600자)
  // 1AB 라인 메시지 (Stacking 1-AB Sepa Run Problem)에 호기별 NG 정보 풍부 — 200자 슬라이스에선 잘림
  const qualityDataLong = qualityList.slice(0, 5).map((m, i) => ({
    no: i + 1,
    date: m.date || "",
    time: m.time || "",
    sender: m.sender || "",
    text: (m.text || "").slice(0, 600).replace(/\n/g, " | "),
  }));

  // ── ★ 영역 12-AF3: 4분할 병렬 호출 (Part 2를 2a/2b로 분할) ──
  // Part 2b가 conditionChangeGroups 전용 — Sonnet이 짧고 정확하게 처리
  console.log("[PE 큐레이션] Sonnet 4분할 병렬 호출 시작 (Part 2 → 2a + 2b)...");
  const startTime = Date.now();

  const [part1, part2a, part2b, part3] = await Promise.all([
    curationPart1_LongDowntime(issuesData, allIssues.length, focus, kbText, longThreshold, categoryMsgs),
    curationPart2a_RecurringSimple(issuesData, processChangeData, allIssues.length, focus, kbText, categoryMsgs),
    // ★ AG1: Part 2b는 long format (10건×800자) 사용
    curationPart2b_ConditionChangeGroups(processChangeDataLong, qualityWithSettingLong, focus, kbText),
    // ★ AH1: Part 3에 qualityDataLong 추가 — chronic1AB 1AB 라인 풍부 추출용
    curationPart3_TestPmQuality(testData, qualityData, focus, kbText, categoryMsgs, qualityDataLong),
  ]);

  // Part 2a + 2b 결과 병합 — conditionChangeGroups는 2b에서, 나머지는 2a에서
  const part2 = {
    recurringByCategory: part2a.recurringByCategory || [],
    recurringSameEquipment: part2a.recurringSameEquipment || [],
    conditionChanges: part2a.conditionChanges || { visionOffset: [], settingChange: [], cutter: [], other: [] },
    conditionChangeGroups: part2b.conditionChangeGroups || [],
  };

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[PE 큐레이션] 4분할 병렬 완료 (${elapsed}초) — 2a: ${part2.recurringByCategory.length} 카테고리 / 2b: ${part2.conditionChangeGroups.length} 그룹`);

  // ★ 영역 12-Z3 + 12-AB5: 룰 백업 — LLM 응답 누락 시 자동 보강
  // 12-AB5: Haiku fallback이 max_tokens로 잘려서 일부만 응답한 경우(예: 4건 중 1건),
  //         LLM 응답은 보존하고 누락된 30분+ 이슈만 추가 (LLM 결과 + 룰 보강)
  let backupLongDowntime = part1.longDowntime || [];
  const llmLongCount = backupLongDowntime.length;
  const dataLongIssues = allIssues.filter(i => (i.durMin || 0) >= longThreshold);
  const dataLongCount = dataLongIssues.length;

  if (llmLongCount < dataLongCount) {
    // LLM이 다룬 equipment 집합 (이미 응답한 건은 제외)
    const llmCoveredEqs = new Set(
      backupLongDowntime.map(d => (d.equipment || "").trim()).filter(Boolean)
    );

    // 누락된 30분+ 이슈 모두 추출 (부동시간 내림차순) — ★ AI2: 12건 cap 제거, 모든 30분+ 호기 표시
    const missingIssues = dataLongIssues
      .filter(i => i.eq && !llmCoveredEqs.has(i.eq.trim()))
      .sort((a, b) => (b.durMin || 0) - (a.durMin || 0));

    if (missingIssues.length > 0) {
      const ruleBackupItems = missingIssues.map((i, idx) => ({
        isTop: false,  // 룰 백업으로 추가된 건 isTop=false
        equipment: i.eq || "?",
        title: `${i.eq || "?"} ${(i.prob || "").slice(0, 60)}${i.prob && i.prob.length > 60 ? "..." : ""} — ${i.durMin}분`,
        occurrence: `${i.date || ""} ${i.time || ""}`,
        alarm: i._alarm || "",
        rootCause: (i.cause || "").slice(0, 200) || "데이터 부족 — 추가 분석 필요",
        partReplaced: "",
        pic: i.pic || "",
        result: i.result || "Unknown",
        durationMin: i.durMin || 0,
        actionSequence: (i.action || "").slice(0, 300)
          ? [(i.action || "").slice(0, 300)]
          : ["조치 정보 없음 — 원본 데이터 확인 필요"],
        splitNote: "",
        splitDetail: [],
        recurrenceGap: "",
        collateralDamage: "",
        historyPattern: "",
        actionAnalysis: "",
        _ruleBackup: true,
      }));

      if (llmLongCount === 0) {
        console.warn(`[PE 큐레이션 룰 백업] LLM 0건 → 데이터 ${dataLongCount}건 모두 자동 보정`);
        // 0건이면 정렬 우선순위: 부동시간 ↓
        backupLongDowntime = ruleBackupItems.map((item, idx) => ({ ...item, isTop: idx < 2 }));
      } else {
        console.warn(`[PE 큐레이션 룰 백업 강화] LLM ${llmLongCount}건 응답 + 데이터 ${dataLongCount}건 → 누락 ${missingIssues.length}건 자동 추가`);
        backupLongDowntime = [...backupLongDowntime, ...ruleBackupItems];
      }
    }
  } else if (llmLongCount > 0) {
    console.log(`[PE 큐레이션] longDowntime 정상 (LLM ${llmLongCount}건, 데이터 기준 ${dataLongCount}건)`);
  }

  // criticalSummary도 빈 경우 룰 백업
  let backupCriticalSummary = part1.criticalSummary || [];
  if (backupCriticalSummary.length === 0 && backupLongDowntime.length > 0) {
    const top = backupLongDowntime[0];
    backupCriticalSummary = [
      `최장 부동: ${top.equipment} ${top.durationMin}분 — ${(top.rootCause || "").slice(0, 100)}`,
      `30분+ 부동 이슈 ${dataLongCount}건 발생`,
      `주목 패턴: 데이터 분석 필요`,
      `품질 추세: 데이터 분석 필요`,
      `특이사항: 큐레이션 LLM 응답 미흡 — 룰 백업 사용`,
    ];
  }

  // 결과 병합 — 영역 12-Y: 새 필드 (recordBreakdown, chronicIssues, conditionChangeGroups, chronic1AB, line3DCutterCpc) 보존
  return normalizeBriefing({
    summary_text: part1.summary_text || (backupLongDowntime.length > 0
      ? `총 ${allIssues.length}건 부동 이슈 발생, ${dataLongCount}건이 ${longThreshold}분 이상 장기부동`
      : ""),
    recordBreakdown: part1.recordBreakdown || { bmDowntime: 0, ubm: 0, pdDowntime: 0, other: 0 },
    criticalSummary: backupCriticalSummary,
    longDowntime: backupLongDowntime,
    chronicIssues: part1.chronicIssues || [],  // ★ 12-Y4 만성 이슈 별도 섹션
    recurringByCategory: part2.recurringByCategory || [],
    recurringSameEquipment: part2.recurringSameEquipment || [],
    conditionChangeGroups: part2.conditionChangeGroups || [],  // ★ 12-Y2 호기별 그룹
    conditionChanges: part2.conditionChanges || { visionOffset: [], settingChange: [], cutter: [], other: [] },
    testPm: part3.testPm || { linePM: [], fmvs: [], cutter: [], stackingSepa: [] },
    chronic1AB: part3.chronic1AB || null,  // ★ 12-Y3 1AB 만성 라인
    line3DCutterCpc: part3.line3DCutterCpc || null,  // ★ 12-Y3 Line 3D CPC
    qualityNg: part3.qualityNg || { table: [], trend: "데이터 없음" },
  });
}

// ─── 분할 헬퍼: 공통 호출 (Sonnet 1차 → 504 시 Haiku fallback) ─────────────────
async function callCurationPart(sys, userMsg, partLabel, allIssuesForFallback = [], categoryMsgsForFallback = {}, maxTokensOverride = null) {
  // ★ 영역 12-Z4: 응답 시간 측정용
  // ★ 영역 12-AE1: maxTokensOverride — Part 2 강화 시 1800→2200 (conditionChangeGroups 풀 출력용)
  const sonnetMaxTokens = maxTokensOverride || 1800;
  const haikuMaxTokens = maxTokensOverride ? Math.min(maxTokensOverride - 400, 1500) : 1200;
  const t0 = Date.now();
  try {
    await new Promise(r => setTimeout(r, 200));
    const raw = await callClaudeRaw(sys, userMsg, {
      model: MODEL_REASONING,  // ★ Sonnet (품질 우선)
      max_tokens: sonnetMaxTokens,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[PE 큐레이션 ${partLabel}] Sonnet 1차 성공 (${elapsed}초, max_tokens ${sonnetMaxTokens})`);
    console.log(`[PE 큐레이션 ${partLabel}] raw 응답 첫 200자:`, (raw || "").slice(0, 200));
    return safeJSON(raw);
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[PE 큐레이션 ${partLabel} 1차 실패] (${elapsed}초)`, e?.message?.slice(0, 200));

    // 504 timeout 시 Haiku로 fallback
    if (e?.message?.includes("504") || e?.message?.includes("Timeout") || e?.message?.includes("timeout")) {
      const tFallback = Date.now();
      try {
        console.log(`[PE 큐레이션 ${partLabel}] Haiku로 fallback 재시도 (max_tokens ${haikuMaxTokens})...`);
        await new Promise(r => setTimeout(r, 800));
        const raw2 = await callClaudeRaw(sys, userMsg, {
          model: MODEL_FAST,  // Haiku fallback
          max_tokens: haikuMaxTokens,
        });
        const elapsedFb = ((Date.now() - tFallback) / 1000).toFixed(1);
        console.log(`[PE 큐레이션 ${partLabel}] Haiku fallback 성공 (${elapsedFb}초)`);
        console.log(`[PE 큐레이션 ${partLabel}] fallback raw 응답 첫 200자:`, (raw2 || "").slice(0, 200));
        return safeJSON(raw2);
      } catch (e2) {
        const elapsedFb = ((Date.now() - tFallback) / 1000).toFixed(1);
        console.error(`[PE 큐레이션 ${partLabel} fallback도 실패] (${elapsedFb}초)`, e2?.message?.slice(0, 200));
      }
    }
    // 최종 실패 — 빈 객체 반환 (병합 시 룰 백업으로 보정)
    return {};
  }
}

// ─── Part 1: 1번 장기부동 (가장 중요) ─────────────────────────────────────────
async function curationPart1_LongDowntime(issuesData, totalCount, focus, kbText, longThreshold, categoryMsgs) {
  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장의 ${PERSONAS.Cell_PE.role.replace(" - Cell 공정", "")}입니다.
이 작업은 일일 이슈 브리핑의 1번 섹션 (장기부동) 정리입니다.${kbText}

${focus}

[★ 최우선 지시 — 절대 누락 금지]
입력 데이터의 부동 이슈 중 duration_min ≥ ${longThreshold} 인 모든 이슈를 longDowntime 배열에 반드시 포함하세요.
빠짐없이 — 30분, 32분, 45분 같은 작은 건도 모두 포함. 30분 미만만 제외.

[필수 출력 — JSON만, 다른 텍스트 금지]
{
  "summary_text": "전체 이슈 흐름 1~3문장 요약",
  "recordBreakdown": {"bmDowntime": 숫자, "ubm": 숫자, "pdDowntime": 숫자, "other": 숫자},
  "criticalSummary": [
    "최장 부동: [설비] [부동시간] — [원인]",
    "동일 호기 다발: [있으면 명시, 없으면 '없음']",
    "주목 패턴: [있으면 명시, 없으면 '없음']",
    "품질 추세: [핵심]",
    "특이사항: [있으면 명시, 없으면 '없음']"
  ],
  "longDowntime": [
    {
      "isTop": true,
      "equipment": "호기명",
      "title": "[설비명] [문제 요약] — N분",
      "occurrence": "발생 시간",
      "alarm": "알람 메시지",
      "rootCause": "근본 원인",
      "partReplaced": "교체 부품 (있으면)",
      "pic": "PIC",
      "result": "Solved/Unsolved/Monitoring",
      "durationMin": 부동분,
      "actionSequence": ["1. 조치", "2. 조치"],

      "splitNote": "(옵셔널) 분할 보고 통합 시만 작성, 단일 보고면 빈 문자열 ''",
      "splitDetail": [],
      "recurrenceGap": "(옵셔널) 단발이면 빈 문자열 ''",
      "collateralDamage": "(옵셔널) 부수 피해 있을 때만, 없으면 ''",
      "historyPattern": "(옵셔널) KB에 단서 있을 때만, 없으면 ''",
      "actionAnalysis": "(옵셔널) 1차 조치 미흡 분석, 해당 없으면 ''"
    }
  ],
  "chronicIssues": []
}

[★ 옵셔널 필드 — 데이터에 명백한 단서 있을 때만 채우세요]
splitDetail / recurrenceGap / collateralDamage / historyPattern / actionAnalysis / chronicIssues 등은
데이터에 명백히 있을 때만 채우고, 없으면 빈 배열/빈 문자열로 빠르게 응답하세요.
풍부함보다 응답 속도와 핵심 누락 방지가 우선입니다.

[규칙]
- 장기부동 임계값: ${longThreshold}분 이상 (이 임계값 절대 변경 금지)
- isTop=true는 가장 큰 부동 1~2건만, 나머지는 isTop=false
- chronicIssues는 24h+ open 또는 cross-day 반복일 때만 (KB에 단서 없으면 빈 배열)
- 모든 수치는 숫자만`;

  const userMsg = `[부동 이슈 데이터 - ${totalCount}건]
${JSON.stringify(issuesData, null, 1)}

위 데이터에서 duration_min >= ${longThreshold} 인 모든 부동 이슈를 longDowntime에 빠짐없이 정리하세요.
옵셔널 필드(splitDetail, historyPattern 등)는 명백한 단서 있을 때만 채우고, 없으면 빈 값으로 응답해 응답 속도를 우선하세요.`;

  // ★ 영역 12-AI2: Part 1 max_tokens 1500 → 1800 (호기 9개+ 풀 추출 위해)
  // 이전 1500은 timeout 안전 마진 위해 줄였지만 호기 4개로 누락 多 (정답 9개)
  // 1800은 timeout 위험 약간 있지만 Sonnet 30초 직전 마지노선, fallback도 있음
  return await callCurationPart(sys, userMsg, "Part1-LongDowntime", [], {}, 1800);
}

// ─── ★ 영역 12-AF: Part 2 분할 (2a: recurring + simple changes, 2b: conditionChangeGroups 전용) ──
// 이유: 기존 Part 2가 max_tokens 2200으로도 timeout (36.6초). 분할해서 각 부분 짧고 정확하게 처리.

// ─── Part 2a: 2번 반복 + 3번 조건변경 (그룹 외 — 단순 변경 항목) ─────────────
async function curationPart2a_RecurringSimple(issuesData, processChangeData, totalCount, focus, kbText, categoryMsgs) {
  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장의 ${PERSONAS.Cell_PE.role.replace(" - Cell 공정", "")}입니다.
이 작업은 일일 이슈 브리핑의 2번 (발생빈도) + 3번 (조건변경 단순 항목) 정리입니다.${kbText}

${focus}

[★ 최우선 지시]
1) 부동 이슈 데이터에서 카테고리별/호기별 반복을 빠짐없이 집계
2) 조건변경 메시지 중 단순 항목을 conditionChanges 4개 그룹에 분류
   (※ 호기별 다중 파라미터 그룹은 별도 작업에서 처리하므로 여기선 제외)

[필수 출력 — JSON만]
{
  "recurringByCategory": [
    {"category":"Servo Fault","count":4,"equipments":["STK-4-B1 (×2)","STK-3-D5"]}
  ],
  "recurringSameEquipment": [
    {"equipment":"호기","count":건수,
     "detail":"★ 사건 단위 — 시각·분 명시 (예: '14:17 Servo Forward Over Run 38min + 15:42 Servo Total Fault 28min')",
     "gapAnalysis":"★ 재발 간격 분석 (예: '47분 간격 재발', '8분 간격 연속 발생')",
     "totalDuration":"누적 N분 (예: '누적 66분')",
     "partsReplaced":"교체 부품 (예: 'Mandrel Y2 + Servo R 모두 교체')"}
  ],
  "conditionChanges": {
    "visionOffset": [{"date":"YY/M/D","time":"HH:MM","equipment":"호기","change":"변경 내용","reason":"사유"}],
    "settingChange": [{"equipment":"호기","parameter":"파라미터명","before":"변경 전","after":"변경 후"}],
    "cutter": [{"date":"YY/M/D","time":"HH:MM","equipment":"호기","change":"변경 내용"}],
    "other": [{"date":"YY/M/D","equipment":"호기","change":"기타 조건 변경","pic":"담당자"}]
  }
}

[★ 영역 12-AI3 — recurringSameEquipment 풍부도 강조]
같은 호기 2건 이상 재발한 경우 다음을 반드시 추출:
1) **detail에 시각·분 명시** — 단순 "2회 발생" 아닌 "14:17 38min + 15:42 28min" 형식
2) **gapAnalysis에 간격 명시** — "47분 간격 재발", "8분 간격 연속 발생"
3) **totalDuration 누적 분 표기** — "누적 66분"
4) **partsReplaced 교체 부품** — "Mandrel Y2 + Servo R 모두 교체"
★ 이 4개 필드는 옵셔널이지만 가능한 한 풍부하게 채울 것 (사건 단위 분석 핵심)

[규칙]
- recurringByCategory: 모든 카테고리 빠짐없이 집계
- recurringSameEquipment: 같은 호기 2건 이상 발생만 (★ detail에 시각·분, gap·누적·부품 풀로 추출)
- conditionChanges 4개 하위 그룹 — 단발 변경/단순 항목만 (다중 파라미터 그룹은 제외)
- 모든 수치는 숫자만`;

  const userMsg = `[부동 이슈 데이터 - ${totalCount}건]
${JSON.stringify(issuesData, null, 1)}

[공정/설비 조건변경 메시지 - ${processChangeData.length}건]
${processChangeData.length > 0 ? JSON.stringify(processChangeData, null, 1) : "(없음)"}

위 데이터를 2번 반복 + 3번 조건변경 단순 항목으로 정리하세요. (다중 파라미터 그룹은 별도 처리)`;

  return await callCurationPart(sys, userMsg, "Part2a-Recurring/Simple", [], {}, 1500);
}

// ─── Part 2b: 3번 조건변경 (conditionChangeGroups 전용) ──────────────────────
// 호기별 다중 파라미터 변경 그룹만 집중 추출
async function curationPart2b_ConditionChangeGroups(processChangeData, qualityWithSetting, focus, kbText) {
  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장의 ${PERSONAS.Cell_PE.role.replace(" - Cell 공정", "")}입니다.
이 작업은 호기별 조건변경 그룹 (다중 파라미터 변경) 정밀 추출 전용입니다.${kbText}

${focus}

[★ 핵심 작업 — 이 작업의 전부]
입력 메시지에서 같은 호기에 대해 여러 파라미터를 변경한 그룹을 풀로 추출하세요.
★★ 각 그룹의 **모든** 파라미터를 빠짐없이 parameters 배열에 포함하세요. **10개 이상도 가능합니다.** ★★
★★ 메시지의 Countermeasures 섹션에 5개, 8개, 10개 항목이 있으면 그 모든 항목을 parameters에 풀로 넣으세요. ★★
★★ 절대 1~2개만 추출하고 끝내지 마세요. 메시지에 명시된 모든 항목을 끝까지 처리하세요. ★★

[★ 인식 패턴]
1) "Machine: Stack 3B2 / Problem: Issue Overhang / Caused: ... / Countermeasures: - Setting Gap ... - Setting Gap ..." 형식
   → 하나의 conditionChangeGroup으로 묶고, **Countermeasures의 모든 항목을 빠짐없이** parameters 배열에 포함
2) Countermeasures 안의 "- Setting Gap 2nd PnP (+) Down Loading 39.6 => 40.0" 같은 항목은
   parameter="Gap 2nd PnP (+) Down Loading", before="39.6", after="40.0"으로 추출
   ★ "=>", "->", "to" 모두 Before/After 구분 기호로 인식
3) "- check vision f/i" "- check gap" 같이 값 없이 점검 항목인 경우
   parameter="Vision f/i 점검", before="", after="Check"
4) Stack NG / Stack Wrinkle 보고도 그룹으로 추출 (문제 호기 + Countermeasures)

[★ Few-shot 예시 — 8개 파라미터 풀 추출]
입력 메시지: "Machine: Stack 3B2 / Problem: Issue Overhang / Caused: anode X value exceeds the limit / Countermeasures: - Check Gap 2nd PnP (+) Down Loading & Unloading - Setting Gap 2nd PnP (+) Down Loading 39.6 => 40.0 - Setting Gap 2nd PnP (+) Down Unloading 32.9 => 33.0 - Check Gap 2nd PnP (-) Down Loading & Unloading - Setting Gap 2nd PnP (-) Down Loading 40.0 => 40.1 - Setting Gap 2nd PnP (-) Down unloading 33.0 => 33.2 - Setting Idle mandrel pressure 180 => 200 - Setting Sepa dancer static pressure 160 => 150 / Time: 08:10 / PIC: Group C / Result: 3 sample CT scan OK"

출력 (★ 메시지의 모든 항목 빠짐없이 ★):
{
  "title": "STK-3-B2 Overhang 대응",
  "equipment": "STK-3-B2",
  "timeRange": "08:10",
  "shift": "Shift 1",
  "picReason": "PIC: Group C · 사유: anode X value exceeds the limit",
  "parameters": [
    {"parameter": "Gap 2nd PnP (+) Down Loading & Unloading 점검", "before": "", "after": "Check"},
    {"parameter": "Gap 2nd PnP (+) Down Loading", "before": "39.6", "after": "40.0"},
    {"parameter": "Gap 2nd PnP (+) Down Unloading", "before": "32.9", "after": "33.0"},
    {"parameter": "Gap 2nd PnP (-) Down Loading & Unloading 점검", "before": "", "after": "Check"},
    {"parameter": "Gap 2nd PnP (-) Down Loading", "before": "40.0", "after": "40.1"},
    {"parameter": "Gap 2nd PnP (-) Down Unloading", "before": "33.0", "after": "33.2"},
    {"parameter": "Idle mandrel pressure", "before": "180", "after": "200"},
    {"parameter": "Sepa dancer static pressure", "before": "160", "after": "150"}
  ],
  "verification": "3 sample CT scan OK"
}
★ 위 예시처럼 — 메시지에 8개 항목이 있으면 8개를 모두 parameters에 풀로 채우세요. 절대 일부만 추출하지 마세요.

[필수 출력 — JSON만, 다른 텍스트 금지]
{
  "conditionChangeGroups": [
    {
      "title": "호기별 그룹 제목",
      "equipment": "호기명 (정규화: Stack 3B2 → STK-3-B2)",
      "timeRange": "발생 시각 (예: '08:10')",
      "shift": "Shift 정보",
      "picReason": "PIC + 사유",
      "parameters": [
        {"parameter": "파라미터명", "before": "값 또는 빈 문자열", "after": "값 또는 'Check'"}
      ],
      "verification": "검증 결과 또는 빈 문자열"
    }
  ]
}

[★ 호기명 정규화]
- "Stack 3B2" → "STK-3-B2"
- "Stack 4-B1" → "STK-4-B1"
- "Stack 4B(-)" → "STK-4-B(-)"
- "1B5" → "STK-1-B5"

[규칙]
- 그룹이 없으면 빈 배열 [] 반환
- ★★ parameters는 메시지에 명시된 **모든** 항목 추출 — 풀로 (10개 이상도 가능, 절대 일부만 X) ★★
- ★★ "Setting X => Y" 형식 항목이 5개 있으면 5개 모두, 8개 있으면 8개 모두 parameters에 포함 ★★
- 단발 변경 (Vision Offset 1건)은 그룹 아님 — 제외
- 모든 수치는 숫자/문자열로 정확히 표기`;

  const userMsg = `[조건변경 메시지 - ${processChangeData.length}건]
${processChangeData.length > 0 ? JSON.stringify(processChangeData, null, 1) : "(없음)"}

[참고: quality 메시지 중 setting 정보 있을 수 있는 것 - ${qualityWithSetting.length}건]
${qualityWithSetting.length > 0 ? JSON.stringify(qualityWithSetting, null, 1) : "(없음)"}
※ "setting z cut", "Stack NG ... Countermeasures" 같은 메시지에 호기별 다중 파라미터 변경 정보가 있을 수 있음

위 메시지에서 같은 호기에 대한 다중 파라미터 변경 그룹을 풀로 추출하세요.
★★ 각 메시지의 Countermeasures **모든** 항목을 parameters 배열에 빠짐없이 포함하세요. ★★
★★ "Setting X => Y" 형식 항목이 5개, 8개, 10개 있으면 그만큼 모두 parameters에 추출. 절대 1~2개만 추출 X. ★★
★ 호기명은 정규화 (Stack 3B2 → STK-3-B2).`;

  return await callCurationPart(sys, userMsg, "Part2b-ConditionChangeGroups", [], {}, 1800);
}

// ─── Part 3: 4번 테스트/PM + 5번 품질NG ───────────────────────────────────────
async function curationPart3_TestPmQuality(testData, qualityData, focus, kbText, categoryMsgs, qualityDataLong = null) {
  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장의 ${PERSONAS.Cell_PE.role.replace(" - Cell 공정", "")}입니다.
이 작업은 일일 이슈 브리핑의 4번 (테스트/PM) + 5번 (품질 NG) 섹션 정리입니다.${kbText}

${focus}

[★ 최우선 지시 — 누락 금지]
입력의 테스트 메시지와 품질 메시지를 빠짐없이 분류해 testPm 4개 그룹 + qualityNg에 정리하세요.

[필수 출력 — JSON만, 다른 텍스트 금지]
{
  "testPm": {
    "linePM": [
      {"date":"YY/M/D","line":"라인명","status":"상태",
       "startTime":"(옵셔널) 시작 시각", "endTime":"(옵셔널) 완료 시각",
       "details":[{"equipment":"호기","work":"PM/Cleaning 등","result":"✅/🔄/❌"}]}
    ],
    "fmvs": [{"date":"YY/M/D","action":"FMVS 작업","equipments":"대상 설비"}],
    "cutter": [
      {"date":"YY/M/D","time":"HH:MM","equipment":"설비 (있으면)","item":"테스트 항목","resultIcon":"✅/❌/🔄","note":"결과"}
    ],
    "stackingSepa": [{"date":"YY/M/D","equipment":"호기","issue":"문제","resultIcon":"❌"}]
  },
  "qualityNg": {
    "table": [{"date":"YY/M/D","sepaFold":숫자,"electrodeExpose":숫자,"nonResponse":숫자,"dimOverkill":숫자,"contactNg":숫자}],
    "trend": "비교 분석 텍스트 (예: 'Sepa Fold 17→18 증가, Electrode Expose 6→10 (+67%)')"
  },
  "chronic1AB": null,
  "line3DCutterCpc": null
}

[★ chronic1AB — 1AB 만성 라인 NG 추출 (★ 핵심 작업)]

1AB 라인 메시지 패턴 인식:
- "Stacking 1 - AB Run sepa Problem" 또는 "Update Line 1AB" 시작 메시지
- "1-A1, 1-A2, 1-A3..." 호기별 JXT lot ID + NG/OK 표시 (✅, ❌, 🔄)
- "JXT11251121022J66103 ( NG ETC YCS 5X Sepa wrinkle Fist stack)" 형식

★★ chronic1AB 추출 규칙 (정답 레포트 양식) ★★
1) **NG 표시된 호기만 byEquipment에 포함** — ✅(OK)만 있는 호기는 제외
2) **NG 패턴 강조** — "NG ETC YCS 5x Sepa wrinkle First stack ❌" 형태로 표기
3) **반복 패턴 강조** — "이번 기간 최다 7X", "2 lot 연속" 같은 표현 추가
4) **호기 6개 정도** 정상 (1-A2, 1-A3, 1-A5, 1-A6, 1-B2, 1-B4/5 등)
5) ✅ 정상 cell은 ngList에서 제외 — 핵심 NG만 표기

[★ Few-shot 예시 — chronic1AB]
입력 메시지:
"Stacking 1-AB Run sepa Problem | Update Line 1AB | 1-A1: JXT...J67103✅, JXT...J66103✅
 1-A2: JXT...J66103 (NG ETC YCS 5X Sepa wrinkle Fist stack) ❌, JXT...J66102
 1-A3: JXT...J66102 (NG ETC Y-CS Y-AS 5X Sepa wrinkle Fist stack) ❌, JXT...J66103 (NG ETC Y-CS Y-AS 5X Sepa wrinkle) ❌
 1-A6: JXT...J67102 (NG SEPA FOLD 3X) ❌
 1-B2: JXT...J67102 (NG YCS First stack 7X) ❌
 1-B4: NG Y-CS 2x Sepa wrinkle"

출력:
{
  "title": "Stacking 1-AB Sepa Run Issues (지속 모니터링)",
  "patternSummary": "Separator wrinkle / YCS / Sepa Fold 3 종류 NG 다발. 1-B2가 7X로 이번 기간 최다, 1-A3은 2 lot 연속 ❌.",
  "byEquipment": [
    {"equipment": "1-A2", "ngList": "JXT...J66103 - NG ETC YCS 5x Sepa wrinkle First stack ❌"},
    {"equipment": "1-A3", "ngList": "JXT...J66102, JXT...J66103 - NG ETC Y-CS·Y-AS 5x Sepa wrinkle ❌ (2 lot 연속)"},
    {"equipment": "1-A6", "ngList": "JXT...J67102 - NG SEPA FOLD 3X ❌"},
    {"equipment": "1-B2", "ngList": "JXT...J67102 - NG YCS First stack 7X ❌ (이번 기간 최다)"},
    {"equipment": "1-B4", "ngList": "NG Y-CS 2x Sepa wrinkle"}
  ]
}

★ ✅(OK) cell은 byEquipment에서 제외, NG ❌ 표시된 호기만 포함하세요.
★ 같은 호기에 NG가 여러 lot 있으면 "JXT-A, JXT-B (2 lot 연속)" 식으로 묶기.

[line3DCutterCpc (옵셔널)]
Line 3D Cutter CPC 모니터링 보고가 있을 때만:
{"status":"내용", "details":["보고1","보고2"]}
없으면 null.

[★ 옵셔널 필드 — 데이터에 명백한 단서 있을 때만]
line3DCutterCpc / linePM.startTime/endTime/details 등은
데이터에 명백히 있을 때만 채우고, 없으면 null 또는 빈 값으로 빠르게 응답.

[규칙]
- testPm 4개 하위 그룹 — 데이터 없으면 빈 배열 []
- qualityNg.table은 데이터에 있는 일자만 (3일치는 KB 활용 가능, 옵셔널)
- qualityNg.trend는 비교 분석 형식, 1일치만 있으면 "1일치 데이터 — 비교 불가"
- chronic1AB는 1AB 라인 메시지에서 NG ❌ 호기만 byEquipment에 포함 (★ 정상 cell 제외)
- 모든 수치는 숫자만`;

  // ★ AH3: qualityDataLong 있으면 chronic1AB 추출용으로 함께 전달 (1AB 메시지 풍부 데이터)
  const qualityLongSection = qualityDataLong && qualityDataLong.length > 0
    ? `\n\n[★ 1AB 만성 라인 분석용 quality 메시지 풀 본문 (chronic1AB 추출 전용) - ${qualityDataLong.length}건]
${JSON.stringify(qualityDataLong, null, 1)}
※ 위 메시지 중 "Stacking 1-AB" "Run sepa Problem" 같은 1AB 라인 보고가 있으면 chronic1AB에 풀로 추출.
※ NG ❌ 표시된 호기만 byEquipment에 포함, ✅ 정상 cell은 제외.`
    : "";

  const userMsg = `[테스트/양산외 생산 메시지 - ${testData.length}건]
${testData.length > 0 ? JSON.stringify(testData, null, 1) : "(없음)"}

[품질 이슈 메시지 - ${qualityData.length}건]
${qualityData.length > 0 ? JSON.stringify(qualityData, null, 1) : "(없음)"}${qualityLongSection}

위 데이터를 4번 테스트/PM + 5번 품질NG 형식으로 정리하세요.
★ 1AB 라인 메시지가 풍부하면 chronic1AB의 byEquipment에 NG 호기 6개 정도 풀로 추출 (✅ 제외, ❌만).
옵셔널 필드(line3DCutterCpc 등)는 명백한 단서 있을 때만, 없으면 null로 빠르게 응답하세요.`;

  return await callCurationPart(sys, userMsg, "Part3-TestPm/Quality");
}

// ─── 영역 11-C: 빈/정규화 헬퍼 ──────────────────────────────────────────────────
function emptyBriefing() {
  return {
    summary_text: "분석 대상 이슈 없음",
    criticalSummary: [],
    longDowntime: [],
    recurringByCategory: [],
    recurringSameEquipment: [],
    conditionChanges: { visionOffset: [], settingChange: [], cutter: [], other: [] },
    testPm: { linePM: [], fmvs: [], cutter: [], stackingSepa: [] },
    qualityNg: { table: [], trend: "데이터 없음" },
    // 하위호환: 옛 필드명도 빈 배열 (일부 코드가 참조)
    daily_table: [], long_downtime: [], recurring: [],
    quality_issues: [], process_changes: [], tests_inspections: [],
  };
}

function normalizeBriefing(parsed) {
  const arr = (v) => Array.isArray(v) ? v : [];
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v)) ? v : {};

  const result = {
    summary_text: parsed.summary_text || "",
    // ★ 영역 12-Y1: 레코드 분류
    recordBreakdown: obj(parsed.recordBreakdown),
    criticalSummary: arr(parsed.criticalSummary),
    longDowntime: arr(parsed.longDowntime),
    // ★ 영역 12-Y4: 만성 이슈 별도
    chronicIssues: arr(parsed.chronicIssues),
    recurringByCategory: arr(parsed.recurringByCategory),
    recurringSameEquipment: arr(parsed.recurringSameEquipment),
    // ★ 영역 12-Y2: 호기별 조건변경 그룹
    conditionChangeGroups: arr(parsed.conditionChangeGroups),
    conditionChanges: {
      visionOffset: arr(obj(parsed.conditionChanges).visionOffset),
      settingChange: arr(obj(parsed.conditionChanges).settingChange),
      cutter: arr(obj(parsed.conditionChanges).cutter),
      other: arr(obj(parsed.conditionChanges).other),
    },
    testPm: {
      linePM: arr(obj(parsed.testPm).linePM),
      fmvs: arr(obj(parsed.testPm).fmvs),
      cutter: arr(obj(parsed.testPm).cutter),
      stackingSepa: arr(obj(parsed.testPm).stackingSepa),
    },
    // ★ 영역 12-Y3: 1AB 만성 라인 / Line 3D CPC
    chronic1AB: parsed.chronic1AB && typeof parsed.chronic1AB === "object" ? parsed.chronic1AB : null,
    line3DCutterCpc: parsed.line3DCutterCpc && typeof parsed.line3DCutterCpc === "object" ? parsed.line3DCutterCpc : null,
    qualityNg: {
      table: arr(obj(parsed.qualityNg).table),
      trend: obj(parsed.qualityNg).trend || "데이터 없음",
    },
  };

  // 하위호환: 일부 코드가 옛 필드명으로 참조 (long_downtime, recurring 등)
  result.long_downtime = result.longDowntime.map(d => ({
    equipment: d.equipment, reason: d.rootCause || d.title, since: "",
    status: d.result, duration_note: `${d.durationMin}분`,
  }));
  result.recurring = result.recurringByCategory.map(r => ({
    item: r.category, lines: r.equipments || [], count: r.count, cause: "",
  }));
  result.daily_table = [];
  result.quality_issues = [];
  result.process_changes = [];
  result.tests_inspections = [];

  return result;
}

// PE 큐레이션 폴백 - 데이터 기반 자동 생성
// ─── 영역 11-C: PE 큐레이션 폴백 (LLM 호출 실패 시 데이터 기반 자동 생성) ───
function buildFallbackCuration(allIssues, categoryMsgs = {}) {
  if (!allIssues || allIssues.length === 0) return emptyBriefing();

  // 일자별 합계
  const byDate = {};
  for (const issue of allIssues) {
    const d = issue.date || "?";
    if (!byDate[d]) byDate[d] = { date: d, count: 0, totalMin: 0 };
    byDate[d].count += 1;
    byDate[d].totalMin += (issue.durMin || 0);
  }

  // 장기부동 (durMin 기준 내림차순 TOP 5, isTop은 가장 큰 1건)
  const sorted = [...allIssues].sort((a, b) => (b.durMin || 0) - (a.durMin || 0));
  const longDowntime = sorted.slice(0, 5).map((i, idx) => ({
    isTop: idx === 0,
    equipment: i.eq || "-",
    title: `${i.eq || "?"} ${(i.prob || "").slice(0, 40)} — ${i.durMin || 0}분`,
    occurrence: `${i.date || ""} ${i.time || ""}`,
    alarm: i._alarm || "",
    splitNote: "",
    rootCause: (i.cause || "").slice(0, 80),
    partReplaced: "",
    pic: i.pic || "",
    result: i.result || "",
    durationMin: i.durMin || 0,
    actionSequence: i.action ? [i.action.slice(0, 100)] : [],
  }));

  // 반복 (설비별)
  const eqCount = {};
  for (const i of allIssues) {
    if (i.eq) eqCount[i.eq] = (eqCount[i.eq] || 0) + 1;
  }
  const recurringSameEquipment = Object.entries(eqCount)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([equipment, count]) => ({
      equipment,
      count,
      detail: allIssues.filter(i => i.eq === equipment).slice(0, 2).map(i => (i.prob || "").slice(0, 30)).join(" / "),
    }));

  // 카테고리별 (단순화 — causeCategory 사용)
  const catCount = {};
  for (const i of allIssues) {
    if (i.causeCategory) catCount[i.causeCategory] = (catCount[i.causeCategory] || 0) + 1;
  }
  const recurringByCategory = Object.entries(catCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([category, count]) => ({
      category,
      count,
      equipments: [...new Set(allIssues.filter(i => i.causeCategory === category).map(i => i.eq).filter(Boolean))].slice(0, 5),
    }));

  return {
    summary_text: `[큐레이션 폴백] 총 ${allIssues.length}건 부동 (LLM 호출 실패 — 데이터 기반 자동 정리)`,
    criticalSummary: [],
    longDowntime,
    recurringByCategory,
    recurringSameEquipment,
    conditionChanges: { visionOffset: [], settingChange: [], cutter: [], other: [] },
    testPm: { linePM: [], fmvs: [], cutter: [], stackingSepa: [] },
    qualityNg: { table: [], trend: "데이터 없음" },
    // 하위호환
    daily_table: Object.values(byDate).map(d => ({ date: d.date, equipment: "(통합)", issue: `${d.count}건`, action: "", downtime: d.totalMin })),
    long_downtime: longDowntime.map(d => ({ equipment: d.equipment, reason: d.rootCause, since: "", status: d.result, duration_note: `${d.durationMin}분` })),
    recurring: recurringByCategory.map(r => ({ item: r.category, lines: r.equipments || [], count: r.count, cause: "" })),
    quality_issues: [],
    process_changes: [],
    tests_inspections: [],
  };
}



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
async function routeAgentOrder(issueCtx, allowedAgents) {
  // allowedAgents: 사용자가 선택한 페르소나 풀 (자동 + 추가)
  // 라우터는 이 풀 안에서만 발언 순서를 결정해야 함

  const personaList = allowedAgents.map(code => {
    const p = PERSONAS[code];
    return `- ${code}: ${p.label} (${p.process}) - ${p.focus.slice(0, 40)}`;
  }).join("\n");

  const sys = `당신은 공장 이슈 논의의 발언 순서를 결정하는 라우터입니다.

[참여 가능 페르소나 - 이 안에서만 선택]
${personaList}

[규칙]
1. 불량·품질·수율 → TE 첫 발언 (선택 가능한 TE 중 관련 공정 우선)
2. 설비 BM·정지 → ME 첫 발언
3. 생산목표·가동률 → PE 첫 발언
4. 반송·MES·WIP 이슈 + FA 참여 시 → FA 포함
5. 외관·검사 이슈 + Vision 참여 시 → Vision 포함
6. 위 [참여 가능 페르소나]에 없는 코드는 절대 사용 금지
7. 모든 참여 가능 페르소나를 발언 순서에 포함시킬 것 (한 명도 빠지지 않게)

JSON만 출력 (다른 텍스트 금지):
{"order":["Cell_TE","Cell_ME","Cell_PE"],"reason":"불량 이슈로 TE 우선"}`;

  try {
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n발언 순서 결정.`, {
      model: MODEL_FAST,
      max_tokens: 200,
    });
    const parsed = safeJSON(raw);
    let order = Array.isArray(parsed.order) ? parsed.order : [];
    // ★ 풀에 없는 페르소나는 자동 제거 (라우터가 잘못 추가한 경우 방어)
    order = order.filter(p => allowedAgents.includes(p));
    // ★ 풀에 있는데 빠진 페르소나는 끝에 추가 (라우터가 빠뜨린 경우 방어)
    for (const a of allowedAgents) {
      if (!order.includes(a)) order.push(a);
    }
    return { order, reason: parsed.reason || "라우터 판단", source: "router" };
  } catch {
    // 폴백: TE 우선 → ME → PE → 나머지
    const fallbackPriority = (code) => {
      if (code.endsWith("_TE")) return 0;
      if (code.endsWith("_ME")) return 1;
      if (code.endsWith("_PE")) return 2;
      if (code === "FA") return 3;
      if (code === "Vision") return 4;
      return 5;
    };
    const order = [...allowedAgents].sort((a, b) => fallbackPriority(a) - fallbackPriority(b));
    return {
      order,
      reason: "라우터 실패 - 기본 순서 (TE→ME→PE→FA→Vision)",
      source: "fallback",
    };
  }
}

// ─── 3. 단일 페르소나 호출 (이전 의견 누적 + 대화체 + JSON 스키마) ─────────────
async function callPersona(personaCode, issueCtx, prevOpinions, kbText, reportType, isPostAction = false, issueStatus = "unknown") {
  // 영역 12-A/B: 새 필드 (근본원인 / 조치안_평가 / 개선안 / 재발방지책) + 이슈 상태별 차등
  // issueStatus: "solved" / "unsolved" / "analyzing" / "unknown"
  const p = PERSONAS[personaCode];
  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const kb = kbText ? `\n\n[학습 내용]\n${kbText.slice(0, 500)}` : "";

  // 이전 발언자 의견 (Phase 1: 새 필드 표시. Phase 2에서 대화형 강화 예정)
  const prevText = prevOpinions.length > 0
    ? `\n\n[먼저 발언한 동료 의견]\n${prevOpinions.map(o => {
        const op = o.opinion || {};
        return `── ${PERSONAS[o.persona]?.label} (${o.persona}) [${op.stance || "-"}] ──
[근본원인] ${op["근본원인"] || op["원인"] || "-"}
[조치안 평가] ${op["조치안_평가"] || op["기존조치_평가"] || "-"}
[개선안] ${op["개선안"] || op["대책"] || "-"}
[재발방지책] ${op["재발방지책"] || "-"}`;
      }).join("\n\n")}`
    : "";

  const conversationGuide = prevOpinions.length > 0
    ? `\n\n[대화 진행 방식]
- 위 동료 의견을 직접 언급/인용하며 대화체로 작성하세요 (예: "Cell_TE의 온도 분석에 동의하며...", "ME가 지적한 베어링 마모 외에...")
- previous_reference 필드에 누구의 어떤 의견을 받아 답하는지 명시
- stance 필드에 동의/부분동의/반대/추가의견 중 선택`
    : `\n\n[첫 발언자 안내]\n- 당신이 첫 발언자입니다. previous_reference는 빈 문자열, stance는 "초기분석"`;

  // 영역 12-B: 이슈 상태별 차등 가이드
  let statusGuide = "";
  if (issueStatus === "solved") {
    statusGuide = `\n\n[★ Solved 이슈 - 회고 + 재발방지 강조]
- 이미 해결된 이슈입니다. PE 큐레이션이 현상/조치결과를 이미 정리했습니다.
- 당신의 역할: ① 기존 조치의 적절성을 회고 평가 ② 보완할 부분 ③ 재발방지책 제안
- "조치안_평가" 필드에 적절/미흡/부적절 + 근거 명시
- "개선안" 필드에 추가 보완책 제시 (예: 다른 라인 horizontal deployment, PM 항목 추가)`;
  } else if (issueStatus === "unsolved") {
    statusGuide = `\n\n[★ Unsolved 이슈 - 즉시 조치 + 재발방지 강조]
- 미해결 이슈입니다. 즉시 조치가 필요합니다.
- 당신의 역할: ① 근본원인 가설 ② 즉시 조치안 ③ 재발방지책
- "조치안_평가" 필드는 "해당없음 (조치 미적용)" 또는 "진행중"
- "개선안" 필드에 즉시 시도 가능한 조치 제안`;
  } else if (issueStatus === "analyzing") {
    statusGuide = `\n\n[★ Analyzing 이슈 - 가설 + 검증 강조]
- 분석 중인 이슈입니다.
- 당신의 역할: ① 근본원인 가설 (확실/의심) ② 검증 방법 ③ 잠정 조치안
- "조치안_평가" 필드는 "진행중"
- "근본원인" 필드는 "가설:" 접두어로 시작 (예: "가설: Z2 coupling 마모")`;
  } else {
    // unknown 또는 기본값
    statusGuide = `\n\n[★ 이슈 상태 미상 - 일반 분석]
- 이슈 상태가 명확하지 않으면 데이터 기반으로 판단
- "조치안_평가"에 가용 정보 기반 평가
- "개선안"에 권고 조치 제안`;
  }

  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장 ${p.role}입니다.

[우선순위] ${p.priority}
[관심 영역] ${p.focus}
[입장] ${p.stance}${kb}

${focus} 다음 이슈를 ${p.role.split(" ")[0]} 관점에서 분석하세요.

★ 중요: PE 큐레이션이 이미 "현상" "조치결과"를 정리했습니다. 당신은 그 부분을 다시 설명하지 말고, 다음 3가지에 집중하세요:
  1) 근본원인 (root cause) — 표면 증상이 아닌 진짜 원인
  2) 조치안 평가 — 기조치는 적절했는지, 미흡한 부분
  3) 개선안 / 재발방지책 — 향후 동일 이슈 방지 방법${conversationGuide}${statusGuide}

★ 발언 방식 (영역 12 Phase 2): 자연스러운 대화체로 발언하세요.
  - "say" 필드에 자유 텍스트로 발언 (이전 동료 의견을 직접 언급/인용/반박, 자기 관점 설명, 100~200자)
  - "quote" 필드에 인용한 동료 발언의 짧은 핵심 1줄 (60자 이내, 첫 발언자는 빈 문자열)
  - "reply_to" 필드에 답변 대상 페르소나 코드 (예: "Cell_TE", 첫 발언자는 빈 문자열)
  - 4축 구조화 필드(근본원인/조치안_평가/개선안/재발방지책)는 사회자 합의용으로 함께 채우되, 본 발언은 say에 자유롭게 풀어쓰세요.

[필수 출력 - JSON만]
{
  "say": "자유 대화체 발언 (이전 동료 인용/반박 포함, 100~200자)",
  "quote": "인용한 동료 발언 핵심 1줄 (60자 이내, 첫 발언자는 빈 문자열)",
  "reply_to": "답변 대상 페르소나 코드 (예: Cell_TE, 첫 발언자는 빈 문자열)",
  "previous_reference": "이전 동료 의견 인용 요약 (60자, 첫 발언자는 빈 문자열) — 호환용",
  "stance": "동의/부분동의/반대/추가의견/초기분석 중 하나",
  "근본원인": "표면 증상이 아닌 진짜 root cause (100자이내, 가설이면 '가설:' 접두어)",
  "조치안_평가": "기조치 적절성 평가 (적절/미흡/부적절/진행중/해당없음 + 근거, 80자이내)",
  "개선안": "구체적 개선 조치 (80자이내)",
  "재발방지책": "장기 재발 방지 방법 (PM 항목 추가, horizontal deployment 등, 80자이내)"
}`;

  // ★ 영역 12-AM: 진단 코드 — 페르소나 호출 실패 원인 추적용 (Console 출력)
  let rawForDebug = null;
  const t0 = Date.now();
  try {
    await new Promise(r => setTimeout(r, 600));
    rawForDebug = await callClaudeRaw(sys, `[이슈]\n${issueCtx}${prevText}`, {
      model: MODEL_REASONING,
      max_tokens: 1200,  // 영역 12 Phase 2: say 자유 텍스트 추가로 토큰 ↑
    });
    const parsed = safeJSON(rawForDebug);
    // safeJSON이 null/empty/비객체 반환 시 진단 대상
    if (!parsed || typeof parsed !== "object" || Object.keys(parsed).length === 0) {
      console.error(`[페르소나 ${personaCode}] safeJSON 빈 결과 — raw 길이=${String(rawForDebug || "").length}, raw 첫 300자:`, String(rawForDebug || "").slice(0, 300));
      throw new Error(`safeJSON returned empty (raw length=${String(rawForDebug || "").length})`);
    }
    return parsed;
  } catch (e) {
    const elapsed = Date.now() - t0;
    const issueShort = String(issueCtx || "").slice(0, 80).replace(/\n/g, " ");
    console.error(`[페르소나 호출 실패] ${personaCode} (${elapsed}ms) | 이슈: ${issueShort}`);
    console.error(`  ↳ 에러 타입: ${e?.name || "Unknown"}`);
    console.error(`  ↳ 에러 메시지: ${e?.message || String(e)}`);
    if (e?.status) console.error(`  ↳ HTTP 상태: ${e.status}`);
    if (e?.cause) console.error(`  ↳ 원인:`, e.cause);
    if (rawForDebug) {
      console.error(`  ↳ raw 응답 길이: ${String(rawForDebug).length}`);
      console.error(`  ↳ raw 첫 300자: ${String(rawForDebug).slice(0, 300)}`);
    } else {
      console.error(`  ↳ raw 응답: 없음 (API 단계 실패 — 네트워크/인증/timeout)`);
    }
    return {
      say: "분석 중 오류 발생",
      quote: "",
      reply_to: "",
      previous_reference: "",
      stance: "분석 오류",
      "근본원인": "분석 중 오류",
      "조치안_평가": "-",
      "개선안": "-",
      "재발방지책": "-",
      _error: `${e?.name || "Error"}: ${e?.message || String(e)}`.slice(0, 200),
      _rawSnippet: rawForDebug ? String(rawForDebug).slice(0, 150) : null,
      _elapsedMs: elapsed,
    };
  }
}

// ─── 4. 사회자: DEEP — 영역 12-E 새 필드 분리 (근본원인_합의 / 조치안_평가_합의 / 개선안_합의) ───
async function moderateDeep(issueCtx, opinions) {
  const opinionsText = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return `── ${p.label} (${o.persona}) [${op.stance || "-"}] ──
[이전 발언 인용] ${op.previous_reference || "(첫 발언자)"}
[근본원인] ${op["근본원인"] || op["원인"] || "-"}
[조치안 평가] ${op["조치안_평가"] || op["기존조치_평가"] || "-"}
[개선안] ${op["개선안"] || op["대책"] || "-"}
[재발방지책] ${op["재발방지책"] || "-"}`;
  }).join("\n\n");

  const sys = `당신은 공장 이슈 논의의 중립 사회자입니다. 어느 한쪽 편들지 않고 객관적으로 종합하세요.
공장 운영 철학: 품질·근본조치 우선, 무리한 가동 지양.

★ 영역 12 새 형식: 페르소나는 "근본원인" "조치안 평가" "개선안" "재발방지책" 4개 축으로 발언합니다.
사회자는 각 축별로 합의/이견을 정리하세요. PE 큐레이션이 이미 "현상" "조치결과"를 정리했으므로, 거기 다시 들어가지 마세요.

JSON만 출력:
{
  "근본원인_합의":"다수가 동의한 root cause (없으면 '합의 없음 — N명 의견 분기')",
  "조치안_평가_합의":"기존 조치의 적절성에 대한 합의 (적절/미흡/부적절 + N명 합의)",
  "개선안_합의":"권고 개선안 (즉시 시도 가능한 행동)",
  "재발방지책_합의":"장기 재발 방지 (PM 항목, horizontal deployment 등)",
  "충돌점":"페르소나간 의견이 갈린 부분 1-3개 (없으면 '없음')",
  "추가_논의_필요":"데이터 부족/검증 필요 사항 (없으면 '없음')",
  "consensus":"위 합의 사항 한 문장 종합 요약 (보고서용)"
}`;

  await new Promise(r => setTimeout(r, 500));
  const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n[엔지니어 의견 — 4축]\n${opinionsText}\n\n4축 합의 형식으로 종합 정리하세요.`, {
    model: MODEL_REASONING,
    max_tokens: 1000,  // 영역 12: 7필드 수용
  });
  return safeJSON(raw);
}

// ─── 5. 사회자: STANDARD — 영역 12-E 새 필드 적용 ───────────────────────────────
async function moderateStandard(issueCtx, opinions) {
  const opinionsText = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return `── ${p.label} (${o.persona}) [${op.stance || "-"}] ──
[근본원인] ${op["근본원인"] || op["원인"] || "-"}
[조치안 평가] ${op["조치안_평가"] || op["기존조치_평가"] || "-"}
[개선안] ${op["개선안"] || op["대책"] || "-"}
[재발방지책] ${op["재발방지책"] || "-"}`;
  }).join("\n\n");

  const sys = `당신은 공장 이슈 논의의 중립 사회자입니다. 의견을 받아 실행 가능한 액션 플랜으로 정리하세요.
의견 백화점 금지, 추상 표현 금지, 담당과 우선순위 명확히.

★ 영역 12 새 형식: 페르소나는 "근본원인" "조치안 평가" "개선안" "재발방지책" 4축으로 발언합니다.

JSON만 출력:
{
  "근본원인_합의":"다수 동의 root cause (1줄)",
  "조치안_평가_합의":"기존 조치 적절성 평가 (1줄)",
  "actions":[
    {"action":"구체적 행동 (60자이내)","owner":"Cell_PE/ME/TE 등","priority":"긴급/중간/낮음","duration":"예: 4h, 2일","type":"개선안/재발방지"}
  ],
  "needsMore":"추가 확인 필요 (없으면 '없음')",
  "summary":"한 줄 핵심 요약 (보고서용)"
}`;

  await new Promise(r => setTimeout(r, 500));
  const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n[의견 — 4축]\n${opinionsText}\n\n액션 플랜으로 정리.`, {
    model: MODEL_REASONING,
    max_tokens: 900,
  });
  return safeJSON(raw);
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

  await new Promise(r => setTimeout(r, 400));
  const raw = await callClaudeRaw(sys, `[완료된 이슈]\n${issueCtx}\n\n짧게 평가.`, {
    model: MODEL_REASONING,
    max_tokens: 400,
  });
  return safeJSON(raw);
}

// ─── 6-1. 사회자 폴백 통합 함수 (영역 12-AL: D3-b 2회 retry + D4-b 4축 stitching) ──
// 단계: 1차 정상 → 1초 대기 → 정상 재시도 → 3초 대기 → 단순 프롬프트 → 코드 stitching
async function moderateWithFallback(mode, issueCtx, opinions) {
  const callPrimary = async () => {
    if (mode === "DEEP")     return await moderateDeep(issueCtx, opinions);
    if (mode === "STANDARD") return await moderateStandard(issueCtx, opinions);
    if (mode === "LITE")     return await moderateLite(issueCtx);
    throw new Error(`Unknown mode: ${mode}`);
  };

  // 1차: 정상 호출
  try {
    const primary = await callPrimary();
    return { ...primary, _fallback_level: "primary" };
  } catch (e1) {
    console.warn(`[Moderator 1차 실패] ${mode}: ${e1.message} — 1초 후 retry 1`);

    // retry 1: 1초 대기 후 동일 정상 호출 재시도
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r1 = await callPrimary();
      return { ...r1, _fallback_level: "retry_primary" };
    } catch (e2) {
      console.warn(`[Moderator retry 1 실패] ${mode}: ${e2.message} — 3초 후 retry 2 (단순)`);

      // retry 2: 3초 대기 후 단순 프롬프트
      await new Promise(r => setTimeout(r, 3000));
      try {
        const r2 = await moderateRetrySimple(mode, issueCtx, opinions);
        return { ...r2, _fallback_level: "retry_simple" };
      } catch (e3) {
        console.warn(`[Moderator retry 2 실패] ${mode}: ${e3.message} — 코드 stitching 사용`);

        // 최종: 코드 레벨 stitching (4축별 페르소나 의견 모음)
        const stitched = codeFallbackModerator(mode, opinions);
        return { ...stitched, _fallback_level: "code_stitching" };
      }
    }
  }
}

// 2차 재시도 - 더 단순한 프롬프트 + 더 짧은 출력 요구
async function moderateRetrySimple(mode, issueCtx, opinions) {
  const opinionsCompact = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return `${p.label}: 근본원인=${op["근본원인"] || op["원인"] || "-"} / 조치평가=${op["조치안_평가"] || op["기존조치_평가"] || "-"} / 개선안=${op["개선안"] || op["대책"] || "-"}`;
  }).join("\n");

  if (mode === "DEEP") {
    const sys = `다음 의견들을 4축 합의 형식으로 짧게 종합하세요. JSON만:
{"근본원인_합의":"...","조치안_평가_합의":"...","개선안_합의":"...","재발방지책_합의":"...","충돌점":"...","추가_논의_필요":"...","consensus":"한 문장 요약"}`;
    await new Promise(r => setTimeout(r, 400));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx.slice(0, 300)}\n\n[의견]\n${opinionsCompact}`, {
      model: MODEL_REASONING,
      max_tokens: 600,
    });
    return safeJSON(raw);
  }

  if (mode === "STANDARD") {
    const sys = `다음 의견을 액션 플랜으로 짧게 정리. JSON만:
{"근본원인_합의":"...","조치안_평가_합의":"...","actions":[{"action":"행동","owner":"담당","priority":"우선순위","duration":"기간","type":"개선안/재발방지"}],"needsMore":"...","summary":"요약"}`;
    await new Promise(r => setTimeout(r, 400));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx.slice(0, 300)}\n\n[의견]\n${opinionsCompact}`, {
      model: MODEL_REASONING,
      max_tokens: 600,
    });
    return safeJSON(raw);
  }

  // LITE
  const sys = `다음 이슈를 짧게 평가. JSON만:
{"supplement":"보완점","recurRisk":"재발우려","prevention":"방지책"}`;
  await new Promise(r => setTimeout(r, 400));
  const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx.slice(0, 300)}`, {
    model: MODEL_REASONING,
    max_tokens: 300,
  });
  return safeJSON(raw);
}

// 최종 폴백 - 코드 레벨 4축 stitching (영역 12-AL D4-b: 모든 페르소나 의견을 4축별로 모음)
function codeFallbackModerator(mode, opinions) {
  // 페르소나별 의견 정리 (영역 12: 새 필드 + 옛 필드 호환)
  const opinionsByPersona = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return {
      label: p?.label || o.persona,
      code: o.persona,
      stance: op.stance || "-",
      근본원인: op["근본원인"] || op["원인"] || "(의견 없음)",
      조치안_평가: op["조치안_평가"] || op["기존조치_평가"] || "해당없음",
      개선안: op["개선안"] || op["대책"] || "(의견 없음)",
      재발방지책: op["재발방지책"] || "(의견 없음)",
      say: op.say || "",
    };
  });

  // 충돌 추출 (반대 stance가 있는지)
  const stances = opinionsByPersona.map(o => o.stance);
  const hasConflict = stances.includes("반대") || stances.includes("부분동의");

  // ★ D4-b 핵심: 4축별로 모든 페르소나 의견을 [라벨: 의견] 형식으로 합치기
  const stitchAxis = (axisKey) => {
    const parts = opinionsByPersona
      .filter(o => o[axisKey] && o[axisKey] !== "(의견 없음)" && o[axisKey] !== "해당없음")
      .map(o => `${o.label}[${String(o[axisKey]).slice(0, 120)}]`);
    if (parts.length === 0) return "(의견 없음 — 사회자 미합의, 자동 stitching)";
    return `${parts.join(" / ")} (사회자 미합의 — 자동 stitching)`;
  };

  if (mode === "DEEP") {
    return {
      근본원인_합의: stitchAxis("근본원인"),
      조치안_평가_합의: stitchAxis("조치안_평가"),
      개선안_합의: stitchAxis("개선안"),
      재발방지책_합의: stitchAxis("재발방지책"),
      충돌점: hasConflict
        ? `반대/부분동의 ${stances.filter(s => s === "반대" || s === "부분동의").length}건 — 자동 감지 (사회자 미합의)`
        : "없음 (자동 판정)",
      추가_논의_필요: "★ 사회자 LLM 호출 실패 — 페르소나 4축 의견을 자동 stitching으로 표시. 정확한 합의는 재실행 권장",
      consensus: `${opinionsByPersona.length}명 의견 자동 stitching: ` + opinionsByPersona.map(o => `${o.label} ${o.stance}`).join(" / ") + " (사회자 호출 실패)",
    };
  }

  if (mode === "STANDARD") {
    const actions = opinionsByPersona.map(o => ({
      action: (o.개선안 || "").slice(0, 80),
      owner: o.code,
      priority: o.stance === "반대" ? "낮음" : "중간",
      duration: "검토 필요",
      type: "개선안 (자동)",
    })).filter(a => a.action);
    return {
      근본원인_합의: stitchAxis("근본원인"),
      조치안_평가_합의: stitchAxis("조치안_평가"),
      actions,
      needsMore: "★ 사회자 LLM 호출 실패 — 페르소나 4축 자동 stitching으로 표시",
      summary: `${opinionsByPersona.length}명 의견 자동 정리 (사회자 호출 실패)`,
    };
  }

  // LITE
  return {
    supplement: "사회자 호출 실패 - 자동 평가 생성됨",
    recurRisk: "낮음 (단순 분석 모드)",
    prevention: "정상 모드에서 재분석 권장",
  };
}

// ─── 6-2. (구버전 호환) 단순 사회자 함수들 - 더 이상 직접 호출 안 함 ────────────
// runIssueDiscussion에서 moderateWithFallback을 호출하므로 위 함수들은 내부에서만 사용


// ─── 7. 통합: 단일 이슈 모드별 논의 실행 ────────────────────────────────────────
async function runIssueDiscussion(issue, modeInfo, kb, reportType, allowedAgents, onProgress) {
  const issueCtx = `설비: ${issue.eq}
발생시간: ${issue.time}
다운타임: ${issue.durMin}분
문제: ${issue.prob}
원인: ${issue.cause}
결과: ${issue.result}
담당자: ${issue.pic}
우선순위 사유: ${issue.reasons?.join(", ")}`;

  // ★ 기조치 건 판단: result에 "solved" 등이 있으면 이미 조치된 건
  const resultLower = (issue.result || "").toLowerCase();
  const isPostAction = resultLower.includes("solved") &&
                       !resultLower.includes("not solved") &&
                       !resultLower.includes("unsolved");

  // 영역 12-B: 이슈 상태 정밀 분류 (Solved/Unsolved/Analyzing/unknown)
  const issueStatus = (() => {
    if (isPostAction) return "solved";
    if (resultLower.includes("not solved") || resultLower.includes("unsolved")) return "unsolved";
    if (resultLower.includes("analyz") || resultLower.includes("분석") || resultLower.includes("진행")) return "analyzing";
    if (resultLower === "" || resultLower === "-") return "unsolved";  // 결과 없음 = 미해결로 간주
    return "unknown";
  })();

  // ─── LITE 모드: 사회자만 단독 호출 (1회) ───
  if (modeInfo.mode === "LITE") {
    onProgress?.(`🟢 LITE 모드 - 사회자 단독 평가${isPostAction ? " (기조치)" : ""}`);
    const result = await moderateWithFallback("LITE", issueCtx, []);
    return {
      issue, modeInfo, isPostAction, issueStatus,
      router: null,
      opinions: [],
      moderator: { type: "lite", ...result },
    };
  }

  // ─── DEEP / STANDARD: 라우터 → 순차 호출 → 사회자 ───
  // [1] 라우터 (선택된 풀 안에서만 결정)
  onProgress?.(`🎯 라우터: 발언 순서 결정 중... (${allowedAgents.length}명 풀)${isPostAction ? " [기조치 건]" : ""}`);
  const router = await routeAgentOrder(issueCtx, allowedAgents);
  onProgress?.(`🎯 발언 순서: ${router.order.map(o => PERSONAS[o]?.label).join(" → ")}`);

  // [2] 페르소나 순차 호출 (영역 12: 새 필드 + issueStatus 차등)
  const opinions = [];
  for (const personaCode of router.order) {
    const p = PERSONAS[personaCode];
    onProgress?.(`${p.icon} ${p.label} 의견 수렴 중... (${opinions.length + 1}/${router.order.length})`);
    const opinion = await callPersona(personaCode, issueCtx, opinions, kb[personaCode] || "", reportType, isPostAction, issueStatus);
    opinions.push({ persona: personaCode, opinion });
  }

  // [3] 사회자 (모드별 분기 + 3단계 폴백)
  onProgress?.(`📋 사회자 종합 중... (${modeInfo.mode})`);
  const result = await moderateWithFallback(modeInfo.mode, issueCtx, opinions);
  const moderator = { type: modeInfo.mode.toLowerCase(), ...result };

  if (result._fallback_level && result._fallback_level !== "primary") {
    onProgress?.(`⚠️ 사회자 폴백 사용: ${result._fallback_level}`);
  }

  return { issue, modeInfo, isPostAction, issueStatus, router, opinions, moderator };
}

// ═════════════════════════════════════════════════════════════════════════════
// 시간/빈도 분석 (인수인계 문서 7번)
// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// 이슈별 상세 카드 생성 (모드별 차등)
// ═════════════════════════════════════════════════════════════════════════════
function buildIssueDetailCard(discussion) {
  const { issue, modeInfo, isPostAction, router, opinions, moderator } = discussion;

  // 페르소나 의견을 종합해 필드별로 추출
  const aggregateField = (fieldName) => {
    return opinions
      .filter(o => o.opinion?.[fieldName] && o.opinion[fieldName] !== "-" && o.opinion[fieldName] !== "해당없음")
      .map(o => `[${PERSONAS[o.persona]?.label}] ${o.opinion[fieldName]}`)
      .join(" / ");
  };

  // 페르소나별 의견 한 줄 요약
  const opinionsByPersona = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return {
      code: o.persona,
      label: p?.label || o.persona,
      icon: p?.icon || "•",
      stance: op.stance || "-",
      summary: `${op["현상"] || "-"} → ${op["원인"] || "-"} → ${op["대책"] || "-"}`,
    };
  });

  // 합의/반대 지점 분석
  const stances = opinions.map(o => o.opinion?.stance);
  const agreedCount = stances.filter(s => s === "동의" || s === "초기분석").length;
  const conflictCount = stances.filter(s => s === "반대" || s === "부분동의").length;
  const consensusPoint = moderator?.type === "deep" ? (moderator.consensus || "-") : "-";
  const conflictPoint = moderator?.type === "deep" ? (moderator.conflicts || "-") : "-";

  if (modeInfo.mode === "DEEP") {
    // DEEP: 8필드 풀 카드
    return {
      mode: "DEEP",
      isPostAction,
      header: `[${issue.time}] ${issue.eq} (${issue.durMin}분)`,
      modeReason: modeInfo.reason,
      fallbackLevel: moderator?._fallback_level || "primary",

      // 8필드
      현상: aggregateField("현상") || issue.prob || "-",
      원인: aggregateField("원인") || issue.cause || "-",
      즉시조치: issue.result || "-",
      기존조치_적절성: isPostAction
        ? (aggregateField("기존조치_평가") || "평가 없음")
        : "(기조치 아님 - 해당없음)",
      재발방지책: moderator?.type === "deep"
        ? (moderator.recommendation || "-")
        : aggregateField("대책"),
      보완책: moderator?.type === "deep"
        ? (moderator.needsMore && moderator.needsMore !== "없음" ? moderator.needsMore : aggregateField("대책"))
        : aggregateField("대책"),
      발언자별의견: opinionsByPersona,
      합의반대지점: `합의: ${consensusPoint} | 충돌: ${conflictPoint} (동의 ${agreedCount}, 반대/부분 ${conflictCount})`,
    };
  }

  // STANDARD/LITE: 3필드 축약
  const liteSupplement = moderator?.type === "lite" ? (moderator.supplement || "-") : "-";
  const literRecur = moderator?.type === "lite" ? (moderator.recurRisk || "-") : "-";
  const litePrev = moderator?.type === "lite" ? (moderator.prevention || "-") : "-";
  const stdSummary = moderator?.type === "standard" ? (moderator.summary || "-") : "-";

  return {
    mode: modeInfo.mode,
    isPostAction,
    header: `[${issue.time}] ${issue.eq} (${issue.durMin}분)`,
    modeReason: modeInfo.reason,
    fallbackLevel: moderator?._fallback_level || "primary",

    // 3필드 축약
    현상: aggregateField("현상") || issue.prob || "-",
    원인: aggregateField("원인") || issue.cause || "-",
    대책: modeInfo.mode === "LITE"
      ? `${litePrev} (재발 우려: ${literRecur} | 보완: ${liteSupplement})`
      : (stdSummary !== "-" ? stdSummary : aggregateField("대책")),
  };
}

function buildTimeFreqAnalysis(allIssues, processName = "Cell") {
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

  // 카테고리(설비) × 공정 빈도
  const eqCounter = new Map();
  for (const issue of allIssues) {
    const eq = (issue.eq || "미분류").trim();
    eqCounter.set(eq, (eqCounter.get(eq) || 0) + 1);
  }
  const categoryFreq = Array.from(eqCounter.entries())
    .map(([eq, count]) => ({ key: `${eq} - ${processName}`, eq, process: processName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { timeOfDay, categoryFreq, total: allIssues.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ 영역 11-E: 6번 "가장 주목할 사항" + 7번 "액션 후속 사항" 생성
// LLM이 페르소나 논의 결과 + 큐레이션 + 5-카테고리 통계를 보고 인사이트/액션 생성
// 환각 방지: confidence 라벨 + 근거 데이터 명시 (ii+iii)
// 7번 P0/P1/P2 분류: LLM 판단 + 룰 검증 (Z)
// ═════════════════════════════════════════════════════════════════════════════
async function generateInsightsAndActions(curation, discussions, taggedResult, kbPE, reportType, categoryMsgs = {}) {
  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const kbText = kbPE ? `\n\n[학습 내용 일부]\n${kbPE.slice(0, 300)}` : "";

  // 사회자 합의 — 영역 12-X4 (2): 새 4축 분리 필드 활용 (옛 consensus도 호환)
  const moderatorSummary = (discussions || []).map((d, i) => {
    const m = d.moderator || {};
    return {
      no: i + 1,
      equipment: d.issue?.eq || "",
      problem: (d.issue?.prob || "").slice(0, 80),
      mode: d.modeInfo?.mode || "",
      issueStatus: d.issueStatus || "unknown",
      // ★ 새 4축 (영역 12 Phase 1) — 우선
      근본원인_합의: (m["근본원인_합의"] || "").slice(0, 200),
      조치안_평가_합의: (m["조치안_평가_합의"] || "").slice(0, 200),
      개선안_합의: (m["개선안_합의"] || "").slice(0, 200),
      재발방지책_합의: (m["재발방지책_합의"] || "").slice(0, 200),
      충돌점: (m["충돌점"] || "").slice(0, 150),
      추가_논의_필요: (m["추가_논의_필요"] || "").slice(0, 150),
      // 옛 호환 (소형 한 줄 종합)
      consensus_summary: (m.consensus || m.summary || m.supplement || "").slice(0, 150),
    };
  });

  // 5-카테고리 통계
  const counts = (taggedResult && taggedResult.counts) || {};

  // 큐레이션 핵심 + 그룹/만성 (★ 영역 12-AI1: conditionChangeGroups + chronic1AB도 6/7번 LLM에 전달)
  const cur = curation || {};
  const briefingSummary = {
    summary_text: cur.summary_text || "",
    criticalSummary: cur.criticalSummary || [],
    longDowntime: (cur.longDowntime || []).slice(0, 8).map(d => ({
      equipment: d.equipment, durationMin: d.durationMin, time: d.time || "",
      rootCause: d.rootCause, splitNote: d.splitNote || "",
      partsReplaced: d.partsReplaced || "", recurrenceGap: d.recurrenceGap || "",
    })),
    recurringByCategory: (cur.recurringByCategory || []).slice(0, 8).map(r => ({
      category: r.category, count: r.count, equipments: (r.equipments || []).slice(0, 5),
    })),
    recurringSameEquipment: (cur.recurringSameEquipment || []).slice(0, 5).map(r => ({
      equipment: r.equipment, count: r.count, detail: r.detail, gapAnalysis: r.gapAnalysis || "",
      totalDuration: r.totalDuration || "", partsReplaced: r.partsReplaced || "",
    })),
    // ★ AI1: conditionChangeGroups — STK-3-B2 매니저 지시 같은 핵심 정보 활용
    conditionChangeGroups: (cur.conditionChangeGroups || []).slice(0, 5).map(g => ({
      title: g.title, equipment: g.equipment, picReason: g.picReason,
      paramCount: (g.parameters || []).length, verification: g.verification || "",
    })),
    chronic1AB: cur.chronic1AB ? {
      title: cur.chronic1AB.title || "",
      patternSummary: cur.chronic1AB.patternSummary || "",
      ngEquipmentCount: (cur.chronic1AB.byEquipment || []).length,
      worstEquipment: (cur.chronic1AB.byEquipment || [])[0]?.equipment || "",
    } : null,
    qualityTrend: cur.qualityNg?.trend || "",
  };

  // ★ AI1: raw 핵심 메시지 발췌 — 매니저 후속 보고 / chronic 1AB / 매니저 지시 (사건 단위 디테일)
  // 6번/7번이 raw 메시지를 못 봐서 사건 단위 디테일 부족 → 풍부한 raw 컨텍스트 제공
  const extractKeyEventMsgs = (msgs, max = 5) => (msgs || []).slice(0, max).map((m, i) => ({
    no: i + 1,
    date: m.date || "",
    time: m.time || "",
    text: (m.text || "").slice(0, 350).replace(/\n/g, " | "),
  }));
  const rawEventContext = {
    process_change_top5: extractKeyEventMsgs(categoryMsgs.process_change, 5),
    quality_top3: extractKeyEventMsgs(categoryMsgs.quality, 3),
  };

  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장의 시니어 엔지니어로서, 페르소나 논의 결과 + PE 큐레이션 + 통계를 바탕으로
보고서의 6번 "가장 주목할 사항"과 7번 "액션 후속 사항"을 작성합니다.${kbText}

${focus}

[★ 영역 12 — 페르소나 4축 합의 활용 강조]
페르소나 사회자 종합은 다음 4축으로 정리되어 있습니다 (방식 나):
  1) 근본원인_합의 — root cause에 대한 합의
  2) 조치안_평가_합의 — 기존 조치의 적절성 평가
  3) 개선안_합의 — 향후 개선 방향
  4) 재발방지책_합의 — 장기 재발 방지

★ 인사이트(6번)와 액션(7번) 작성 시 위 4축을 다음과 같이 활용:
  - 6번 인사이트의 근거(evidence)는 "[설비명] 근본원인_합의" 또는 "[설비명] 충돌점" 형태로 명시
  - 7번 액션은 사회자 "개선안_합의"와 "재발방지책_합의"에서 직접 도출 (P0/P1/P2 분류)
  - "충돌점"이 있는 이슈는 "가설-검증필요" confidence + "추가 논의 필요" 액션으로 기재

[★★★ 영역 12-AI1 — 사건 단위 디테일 작성 (가장 중요) ★★★]
6번 인사이트는 **개념적 통계가 아니라 구체적 사건 단위**로 작성하세요.

❌ 나쁜 예 (개념적, 통계만):
  "STK-4호기 다발 부동 — 설비 정비 품질 악화 신호"
  "Ejector 타임아웃 & Servo Fault 반복 — 근본조치 미완"

✅ 좋은 예 (구체적, 시각·분·인과 명시):
  "STK-4-B1 Stack Table R Servo 47분 간격 2회 발생: 14:17 Servo Forward Over Run → 2nd PnP(+) 충돌, 15:42 Servo Total Fault → Servo R 자체 교체. 1차 조치(homing/tunning)로 해결 안 됨, servo 자체 결함 가능성"
  "STK-3-C4 Heat Press 영역 8분 간격 2회: 04:57 cable loose, 05:38 mechanical interference. 두 이슈가 timing fault로 연관 가능성"
  "STK-3-B2 Overhang — 10개 파라미터 동시 변경 후 Agam 매니저 직접 개입 (Gearbox 교체 deep investigation 지시)"

★ 입력 데이터의 conditionChangeGroups, recurringSameEquipment, raw 메시지를 활용해
  시각, 호기명, 부품명, 분 수치, 매니저 지시 등 구체적 사실을 포함하세요.

[★ 7번 액션 — P0 우선순위 명시 (가장 중요)]
P0 (안전·환경, 매니저 직접 지시, horizontal deployment) 액션을 반드시 포함하세요.
다음 패턴은 P0:
  - 매니저 직접 지시 사항 (예: "Agam 매니저 → Gearbox 교체 deep investigation")
  - 동일 호기 짧은 간격 재발 → horizontal deployment (예: "Servo R 31137 single turn fault 점검")
  - mechanical interference 의심 → 합동 조사

[환각 방지 규칙 — 매우 중요]
- 각 인사이트와 액션에 confidence 라벨 (확실/가설-검증필요)을 반드시 명시
- 가설(검증 필요)인 경우, 어느 데이터에서 도출했는지 근거(evidence) 명시
- 데이터로 확실히 뒷받침되지 않는 인과 추론은 반드시 "가설-검증필요"로 표기
- 알려지지 않은 과거 사례를 추측해서 만들지 마세요 — 직접 데이터에 없으면 언급 금지

[7번 P0/P1/P2 분류 기준]
- P0: 매니저 직접 지시, 안전·환경 키워드, horizontal deployment, mechanical interference 합동 조사
- P1: 미해결 이슈, root cause 미파악, 4시간+ 부동, 예방 교체 cycle 표준화
- P2: 모니터링, 일정 협의, 단일 설비 단발 이슈, 1시간 이하

[필수 출력 - JSON만, 다른 텍스트 금지]
{
  "section6_insights": [
    {
      "title": "1) [핵심 키워드] — [설비/현상]",
      "bulletPoints": [
        "★ 시각·호기·분·부품·인과를 포함한 구체적 사실 (80~120자)",
        "추가 관찰 또는 패턴 (60~100자)"
      ],
      "confidence": "확실 또는 가설-검증필요",
      "evidence": "어느 이슈/데이터에서 도출했는지"
    }
  ],
  "section7_actions": [
    {
      "priority": "P0/P1/P2",
      "action": "구체적 행동 (60자)",
      "context": "왜 필요한지 (40자)",
      "evidence": "어느 데이터에서 도출 (40자)",
      "confidence": "확실 또는 가설-검증필요"
    }
  ]
}

[규칙]
- section6_insights: **5~6개** (사용자 레포트와 동일 분량)
- section7_actions: **P0 2~3개 + P1 3~4개 + P2 2~3개 = 총 7~10개** (P0 반드시 포함)
- 각 인사이트는 bulletPoints 1~3개
- ★ 인사이트는 통계 카테고리가 아닌 **사건 단위**로 작성 (시각, 호기, 분, 부품, 인과)
- 데이터 근거 없는 추측은 절대 만들지 마세요
- confidence는 데이터로 명확히 검증된 것만 "확실", 추론/가설은 "가설-검증필요"`;

  const userMsg = `[PE 큐레이션 요약]
${JSON.stringify(briefingSummary, null, 1)}

[페르소나 논의 결과 — 사회자 4축 합의 (영역 12 방식 나)]
${moderatorSummary.length > 0 ? JSON.stringify(moderatorSummary, null, 1) : "(논의된 이슈 없음 — 큐레이션만으로 인사이트 도출)"}

[★ 영역 12-AI1: raw 핵심 메시지 (사건 단위 디테일 추출용)]
${JSON.stringify(rawEventContext, null, 1)}
※ 위 process_change_top5에 매니저 지시 ("hadehh, please do investigation deeply ... gearbox change")나
   동일 호기 다중 파라미터 변경 같은 정보가 있을 수 있음. 사건 단위 디테일에 활용.

[5-카테고리 통계]
장기부동: ${counts.LONG_DOWNTIME || 0} / 반복: ${counts.HIGH_FREQUENCY || 0} / 조건변경: ${counts.CONDITION_CHANGE || 0} / 테스트PM: ${counts.TEST_PM || 0} / 품질NG: ${counts.QUALITY_NG || 0}

위 데이터를 바탕으로:
★ 6번 "가장 주목할 사항" 5~6건 — **사건 단위** (시각·호기·분·부품·인과 구체 명시)
★ 7번 "액션 후속 사항" 총 7~10건 — **P0 2~3개 반드시 포함** (매니저 직접 지시, horizontal deployment 등)
환각 방지를 위해 confidence와 evidence를 반드시 명시하세요.`;

  try {
    await new Promise(r => setTimeout(r, 500));
    const raw = await callClaudeRaw(sys, userMsg, {
      model: MODEL_REASONING,  // ★ AI1: Haiku → Sonnet (사건 단위 디테일에 추론력 필요)
      max_tokens: 3500,  // P0 포함 7~10개 액션 + 5~6개 인사이트 풀 작성
    });
    const parsed = safeJSON(raw);

    // 룰 검증 (Z 옵션) — LLM 분류 결과를 안전 룰로 보정
    const insights = Array.isArray(parsed.section6_insights) ? parsed.section6_insights : [];
    const actions = Array.isArray(parsed.section7_actions) ? parsed.section7_actions : [];

    // P0/P1/P2 룰 검증
    const validatedActions = actions.map(a => {
      const text = `${a.action || ""} ${a.context || ""} ${a.evidence || ""}`.toLowerCase();
      // 룰 1: safety/환경/9시간+ → P0 강제
      if (/safety|emergency|환경|safety|9시간|horizontal/i.test(text) && a.priority !== "P0") {
        return { ...a, priority: "P0", _ruleAdjusted: "safety 키워드로 P0 격상" };
      }
      // 룰 2: monitoring/모니터링/일정 → P2 강제
      if (/monitoring|모니터링|일정|schedule/i.test(text) && a.priority === "P0") {
        return { ...a, priority: "P2", _ruleAdjusted: "monitoring 키워드로 P2 강등" };
      }
      // priority가 없거나 잘못된 값
      if (!["P0", "P1", "P2"].includes(a.priority)) {
        return { ...a, priority: "P2", _ruleAdjusted: "priority 미지정 — P2 기본" };
      }
      return a;
    });

    return {
      section6_insights: insights,
      section7_actions: validatedActions,
    };
  } catch (e) {
    console.error("[6/7번 생성 실패]", e);
    return buildFallbackInsightsAndActions(curation, taggedResult);
  }
}

// 6/7번 폴백 (LLM 호출 실패 시 룰 기반)
function buildFallbackInsightsAndActions(curation, taggedResult) {
  const cur = curation || {};
  const counts = (taggedResult && taggedResult.counts) || {};
  const insights = [];
  const actions = [];

  // 인사이트 — 룰 기반
  if ((cur.longDowntime || []).length > 0) {
    const top = cur.longDowntime[0];
    insights.push({
      title: `1) ${top.equipment || "?"} — ${top.durationMin || 0}분 부동, 기간 최장`,
      bulletPoints: [
        `근본 원인: ${(top.rootCause || "분석 중").slice(0, 60)}`,
        top.splitNote ? "분할 보고 형태로 전체 누적 시간 추적 필요" : "단일 보고",
      ].filter(Boolean),
      confidence: "확실",
      evidence: `longDowntime[0] - ${top.equipment}`,
    });
  }
  if ((cur.recurringByCategory || []).length > 0) {
    const top = cur.recurringByCategory[0];
    insights.push({
      title: `2) ${top.category} 카테고리 ${top.count}건 다발`,
      bulletPoints: [
        `해당 설비: ${(top.equipments || []).slice(0, 3).join(", ")}`,
        "반복 발생 패턴 확인 필요",
      ],
      confidence: "확실",
      evidence: `recurringByCategory[0]`,
    });
  }
  if (cur.qualityNg?.trend && cur.qualityNg.trend !== "데이터 없음") {
    insights.push({
      title: `3) 품질 NG 트렌드`,
      bulletPoints: [cur.qualityNg.trend.slice(0, 100)],
      confidence: "확실",
      evidence: "qualityNg.trend",
    });
  }

  // 액션 — 룰 기반
  if ((cur.longDowntime || []).filter(d => (d.durationMin || 0) >= 540).length > 0) {
    actions.push({
      priority: "P0",
      action: "최장 부동 이슈 horizontal deployment 점검",
      context: "9시간+ 부동, 학습 내용 다른 라인 적용",
      evidence: "longDowntime durationMin >= 540",
      confidence: "확실",
    });
  }
  if ((cur.longDowntime || []).filter(d => /not solved|unsolved/i.test(d.result || "")).length > 0) {
    actions.push({
      priority: "P1",
      action: "미해결 이슈 root cause 분석",
      context: "Solved되지 않은 장기부동 존재",
      evidence: "longDowntime result 미해결",
      confidence: "확실",
    });
  }
  if ((cur.testPm?.linePM || []).filter(p => /stop/i.test(p.status || "")).length > 0) {
    actions.push({
      priority: "P2",
      action: "PM 일정 협의",
      context: "Stop No Production 발생",
      evidence: "testPm.linePM",
      confidence: "확실",
    });
  }

  return {
    section6_insights: insights,
    section7_actions: actions,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 보고서 생성 (모드별 그룹핑 + 시간/빈도 분석 추가)
// ═════════════════════════════════════════════════════════════════════════════
async function generateReport(date, dates, discussions, priority, reportType, kb, allIssues, processName = "Cell", curation = null) {
  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const reportTitle = REPORT_TYPES.find(r => r.id === reportType)?.label || "회의록";
  const dateStr = dates.length > 1 ? `${dates[0]} ~ ${dates[dates.length-1]}` : date;

  // 시간/빈도 분석 (모든 이슈 대상)
  const analytics = buildTimeFreqAnalysis(allIssues, processName);

  // ★ 이슈별 상세 카드 생성 (모드별 차등)
  const detailCards = discussions.map(d => buildIssueDetailCard(d));

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
본문 논의: ${priority.urgent.length + priority.important.length + priority.normal.length}건 (LONG_DOWNTIME ${priority.urgent.length} / HIGH_FREQUENCY ${priority.important.length})
모드별 분석: DEEP ${grouped.DEEP.length} / STANDARD ${grouped.STANDARD.length} / LITE ${grouped.LITE.length}

[시간대별 발생 TOP 5]
${analytics.timeOfDay.map((t, i) => `${i+1}. ${t.label} ${t.count}건`).join("\n")}

[빈도 TOP 5 (설비×공정)]
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
{"heading":"4. 담당자별 액션 아이템","items":["[PE] 조치 (60자이내)","[ME] 조치","[TE] 조치","[FA] 조치 (해당시)","[Vision] 조치 (해당시)"]}`;
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
    attendees: "선택된 공정 PE/ME/TE + 추가 에이전트",
    agenda: `본문 논의 ${priority.urgent.length + priority.important.length + priority.normal.length}건 분석 및 대책 수립`,
    sections,
    discussions,
    detailCards,    // ★ 이슈별 상세 카드 (모드별 차등)
    curation,       // ★ PE 사전 큐레이션
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
  // ★ 영역 8: 날짜 범위 선택 (start/end/unit). 분석 함수는 selDates 사용 — selRange는 표시/분기용.
  const [selRange, setSelRange]   = useState({ start: null, end: null, unit: "day" });
  const [reportType, setReportType] = useState("meeting");
  // ★ 영역 9-D: 보고서 생성 모드 (간단=명세서 표 형태, 상세=페르소나 8명 논의)
  // 영역 11: reportMode (간단/상세 모드) 폐기. 단일 흐름.
  // ★ 영역 9: 명세서 5-카테고리 분류 결과 (간단모드 표 출력용)
  const [taggedIssues, setTaggedIssues] = useState(null);
  const [classified, setClassified] = useState(null);
  const [priority, setPriority]   = useState(null);
  const [kbStats, setKbStats]     = useState(null);
  const [discussions, setDiscussions] = useState([]);
  const [minutes, setMinutes]     = useState(null);
  const [progress, setProgress]   = useState([]);
  const [running, setRunning]     = useState(false);
  const [error, setError]         = useState("");
  const [sheetSaved, setSheetSaved] = useState(false);
  // ★ 공정/추가 에이전트 선택 state
  const [selectedProcess, setSelectedProcess] = useState("Cell");
  const [extraAgents, setExtraAgents] = useState([]);
  // ★ 영역 5: 선정 기준 드롭다운 (평소 숨김)
  const [showCriteriaBox, setShowCriteriaBox] = useState(false);
  // ★ 영역 6: PE 사전 큐레이션 결과 캐싱 + 사용자 선택 이슈 관리
  const [preCuration, setPreCuration] = useState(null);          // 큐레이션 결과 (재사용 위해 캐싱)
  const [preCategoryMsgs, setPreCategoryMsgs] = useState(null);  // 카테고리 메시지 (재사용)
  const [autoSelectedIds, setAutoSelectedIds] = useState([]);    // 자동 선정된 이슈 id 목록 (TOP N)
  const [selectedIssueIds, setSelectedIssueIds] = useState([]);  // 사용자가 최종 선택한 이슈 id 목록
  const [curating, setCurating] = useState(false);               // 큐레이션 실행 중 플래그
  // ★ 영역 7: 자유 채팅방
  const [chatOpen, setChatOpen] = useState(false);                // 채팅창 표시 여부
  const [chatStage, setChatStage] = useState("setup");           // "setup" (에이전트 선택) | "active" (대화 중)
  const [chatAgents, setChatAgents] = useState([]);              // 채팅방 참석 에이전트 코드 배열
  const [chatKb, setChatKb] = useState({});                       // 채팅 전용 KB 캐시 (방 개설 시 1회 로드)
  const [chatMessages, setChatMessages] = useState([]);          // {role:"user"|"assistant", agent?:string, text, time}
  const [chatInput, setChatInput] = useState("");                 // 입력창
  const [chatBusy, setChatBusy] = useState(false);                // AI 응답 대기 중
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

  // ★ 영역 6: getIssueId는 모듈 최상위 함수로 이동 (BriefingDisplay 등에서도 사용)

  const handleReportConfirm = async () => {
    setError("");
    const dayMsgs = filterByDates(allMsgs, selDates);
    const cl = classifyMessages(dayMsgs);
    const allIssuesFlat = extractAllIssues(cl.downtime);  // 영역 11-A: priority 객체 대신 평면 배열
    setClassified(cl);
    setPriority(allIssuesFlat);  // priority state는 이제 평면 배열을 보유

    // ★ 영역 12-AA: Duration 파싱 진단 로그
    const dur30plus = allIssuesFlat.filter(i => (i.durMin || 0) >= 30).length;
    const dur60plus = allIssuesFlat.filter(i => (i.durMin || 0) >= 60).length;
    const dur0 = allIssuesFlat.filter(i => (i.durMin || 0) === 0).length;
    console.log(`[Duration 파싱 진단] BM Bot 전체 ${allIssuesFlat.length}건 / 30분+ ${dur30plus}건 / 60분+ ${dur60plus}건 / durMin=0 ${dur0}건`);
    if (allIssuesFlat.length > 0) {
      console.log(`[Duration 샘플]`, allIssuesFlat.slice(0, 3).map(i => ({
        eq: i.eq, durMin: i.durMin, prob: (i.prob || "").slice(0, 50)
      })));
    }
    console.log(`[메시지 분류] downtime ${cl.downtime?.length || 0} / quality ${cl.qualityMsgs?.length || 0} / process_change ${cl.processChangeMsgs?.length || 0} / test ${cl.testMsgs?.length || 0} / ambiguous ${cl.ambiguousMsgs?.length || 0}`);

    // ★ 영역 6-B: STEP 3 진입 전에 PE 큐레이션을 미리 실행 (사용자가 자동 선정 결과를 바로 보고 추가 선택할 수 있도록)
    setCurating(true);
    setProgress(["📝 PE 사전 큐레이션 실행 중 (전체 이슈 정리)..."]);
    setStep(3);  // STEP 3 화면으로 먼저 전환 (로딩 표시 포함)

    try {
      // 카테고리 메시지 준비 (영역 5 흐름과 동일)
      const ambig = cl.ambiguousMsgs || [];
      let ambigResult = { quality: [], process_change: [], test: [], skip: [] };
      if (ambig.length > 0) {
        setProgress(p => [...p, `🔀 모호 메시지 AI 분류 중 (${ambig.length}건)...`]);
        try {
          ambigResult = await classifyAmbiguousMessages(ambig);
          setProgress(p => [...p, `✅ 모호 분류 완료 (품질 ${ambigResult.quality.length} / 공정변경 ${ambigResult.process_change.length} / 테스트 ${ambigResult.test.length})`]);
        } catch {
          setProgress(p => [...p, `⚠️ 모호 분류 실패 — 첫 매칭 카테고리로 자동 할당`]);
          ambig.forEach(m => {
            const first = m.matched?.[0];
            if (first === "quality") ambigResult.quality.push(m);
            else if (first === "process_change") ambigResult.process_change.push(m);
            else if (first === "test") ambigResult.test.push(m);
          });
        }
      }
      const categoryMsgs = {
        quality: [...(cl.qualityMsgs || []), ...ambigResult.quality],
        process_change: [...(cl.processChangeMsgs || []), ...ambigResult.process_change],
        test: [...(cl.testMsgs || []), ...ambigResult.test],
      };
      // ★ 영역 12-AD2: 최종 카테고리 메시지 분포 로그 (ambiguous 분배 결과 확인용)
      console.log(`[메시지 최종 분류] quality ${categoryMsgs.quality.length} (직접 ${cl.qualityMsgs?.length || 0} + 모호 ${ambigResult.quality.length}) / process_change ${categoryMsgs.process_change.length} (직접 ${cl.processChangeMsgs?.length || 0} + 모호 ${ambigResult.process_change.length}) / test ${categoryMsgs.test.length} (직접 ${cl.testMsgs?.length || 0} + 모호 ${ambigResult.test.length})`);
      if (ambig.length > 0 && (ambigResult.skip?.length || 0) > 0) {
        console.log(`[모호 분류] skip ${ambigResult.skip.length}건 (어디에도 분류 안 됨)`);
      }

      // ★ 영역 12-AE0 + AE3: 카테고리별 raw 메시지 샘플 출력 (LLM에 들어가는 데이터 확인용)
      // 사용자 정답 레포트 (24일자) 5개 그룹 (STK-3-B2 Overhang, Cutter 2C, STK-4-B1, STK-4-B3, STK-2-A1)이
      // 실제 데이터에 있는지 확인 — 풍부도 갭의 원인 진단 (데이터 부족 vs LLM 부족)
      // AE3: 250자 → 500자로 확장 (Cutter 2C, STK-2-A1 등 데이터 유무 정확 확인)
      console.log(`[process_change 메시지 raw — ${categoryMsgs.process_change.length}건 중 최대 10건]`);
      categoryMsgs.process_change.slice(0, 10).forEach((m, i) => {
        const preview = (m.text || "").replace(/\n/g, " | ").slice(0, 500);
        console.log(`  [PC-${i+1}] ${m.date || "?"} ${m.time || "?"} ${m.sender || "?"}: ${preview}${m.text.length > 500 ? "..." : ""}`);
      });
      console.log(`[test 메시지 raw — ${categoryMsgs.test.length}건 중 최대 10건]`);
      categoryMsgs.test.slice(0, 10).forEach((m, i) => {
        const preview = (m.text || "").replace(/\n/g, " | ").slice(0, 500);
        console.log(`  [TST-${i+1}] ${m.date || "?"} ${m.time || "?"} ${m.sender || "?"}: ${preview}${m.text.length > 500 ? "..." : ""}`);
      });
      if (categoryMsgs.quality.length > 0) {
        console.log(`[quality 메시지 raw — ${categoryMsgs.quality.length}건 중 최대 5건]`);
        categoryMsgs.quality.slice(0, 5).forEach((m, i) => {
          const preview = (m.text || "").replace(/\n/g, " | ").slice(0, 500);
          console.log(`  [QL-${i+1}] ${m.date || "?"} ${m.time || "?"} ${m.sender || "?"}: ${preview}${m.text.length > 500 ? "..." : ""}`);
        });
      }

      // ★ 영역 12-Y5: 큐레이션에 KB 활용 (Cell_PE / Elec_PE 우선, 없으면 빈 문자열)
      let kbForCuration = "";
      try {
        setProgress(p => [...p, `📚 PE KB 로딩 중... (cross-day 패턴 분석용)`]);
        const peKbResult = await loadSelectedKnowledge(["Cell_PE", "Elec_PE"]);
        kbForCuration = peKbResult.kb["Cell_PE"] || peKbResult.kb["Elec_PE"] || "";
        if (kbForCuration) {
          setProgress(p => [...p, `✅ KB 로딩 완료 (${kbForCuration.length} 자)`]);
        } else {
          setProgress(p => [...p, `ℹ️ KB 비어있음 — 단일 일자 분석으로 진행`]);
        }
      } catch (e) {
        setProgress(p => [...p, `⚠️ KB 로딩 실패 — KB 없이 진행`]);
        kbForCuration = "";
      }

      // PE 큐레이션 실행 (12-Y5: KB 활용)
      const allIssuesForCuration = allIssuesFlat;
      let curation;
      try {
        curation = await runPreCuration(allIssuesForCuration, kbForCuration, reportType, categoryMsgs);
        setProgress(p => [...p, `✅ PE 큐레이션 완료 (장기부동 ${curation.long_downtime.length}건, 반복 ${curation.recurring.length}건)`]);
      } catch {
        setProgress(p => [...p, `⚠️ PE 큐레이션 실패 — 폴백 사용`]);
        curation = buildFallbackCuration(allIssuesForCuration, categoryMsgs);
      }

      // ★ 영역 11-B: 5-카테고리 분류 즉시 실행 (체크박스 + 큐레이션 모두 활용)
      const taggedNow = classifyIssues5Category(allIssuesFlat, {
        longDowntimeThresholdMin: reportType === "weekly" ? 60 : 30,
        repeatThreshold: 2,
      });
      setTaggedIssues(taggedNow);

      // ★ 영역 11-7-1: 자동 선정 = LONG_DOWNTIME 또는 HIGH_FREQUENCY tag 보유 이슈
      const autoSelected = taggedNow.issues.filter(i =>
        (i.tags || []).includes("LONG_DOWNTIME") || (i.tags || []).includes("HIGH_FREQUENCY")
      );
      // 점수순 정렬 후 MAX_ISSUES 제한
      const autoScored = autoSelected.map(issue => {
        const s = scoreIssueMatrix(issue);
        return { ...issue, score: s.total };
      }).sort((a, b) => b.score - a.score).slice(0, MAX_ISSUES);
      const autoIds = autoScored.map(getIssueId);

      setPreCuration(curation);
      setPreCategoryMsgs(categoryMsgs);
      setAutoSelectedIds(autoIds);
      setSelectedIssueIds(autoIds);  // 초기값 = 자동 선정 (사용자가 추가/제거 가능)
      setProgress(p => [...p, `🎯 자동 선정 ${autoIds.length}건 (LONG_DOWNTIME/HIGH_FREQUENCY tag). 추가 선택 후 분석 시작 가능.`]);
    } catch (e) {
      setError(`STEP 3 준비 중 오류: ${e?.message || e}`);
    } finally {
      setCurating(false);
    }
  };

  // ★ 영역 6: 체크박스 토글
  const toggleIssueSelection = (id) => {
    setSelectedIssueIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const runAnalysis = async () => {
    setRunning(true); setError(""); setProgress([]);
    setDiscussions([]); setMinutes(null); setSheetSaved(false);

    try {
      // ★ 선택된 페르소나 풀 구성: 공정 자동 + 추가 선택
      const autoAgents = PROCESSES[selectedProcess].auto;
      const allowedAgents = [...autoAgents, ...extraAgents];

      setProgress([`🎯 참여 에이전트: ${allowedAgents.map(a => PERSONAS[a]?.label).join(", ")} (${allowedAgents.length}명)`]);

      // 학습 내용 선별 로드 (선택된 페르소나만)
      setProgress(p => [...p, `📚 학습 내용 로드 중 (${allowedAgents.length}종)...`]);
      let kbResult;
      try {
        kbResult = await loadSelectedKnowledge(allowedAgents);
        setKbStats(kbResult.stats);
        const statsStr = allowedAgents.map(a => `${a}:${kbResult.stats[a] || 0}`).join(" ");
        setProgress(p => [...p, `✅ 학습 로드 완료 (${statsStr})`]);
      } catch {
        kbResult = { kb: {}, stats: { failed: allowedAgents.length } };
        allowedAgents.forEach(a => { kbResult.kb[a] = ""; kbResult.stats[a] = 0; });
        setKbStats(kbResult.stats);
        setProgress(p => [...p, "⚠️ 학습 로드 실패 — 기본 역할로 진행"]);
      }

      // ★ 영역 11-A: priority가 평면 배열이라 직접 사용. taggedIssues가 5-카테고리 분류 결과.
      // 자동 선정 + 사용자 추가 = selectedIssueIds (체크박스로 자유 선택)
      // tagged.issues는 모든 이슈에 tags 부착된 상태
      const allIssuesFlat = priority || [];

      // 5-카테고리 분류는 STEP 3 진입 시 이미 실행됨 (taggedIssues state). 없으면 여기서 재계산.
      let taggedResult = taggedIssues;
      if (!taggedResult) {
        taggedResult = classifyIssues5Category(allIssuesFlat, {
          longDowntimeThresholdMin: reportType === "weekly" ? 60 : 30,
          repeatThreshold: 2,
        });
        setTaggedIssues(taggedResult);
      }

      // 사용자가 STEP 3에서 체크한 이슈 = 본문 논의 대상 (DEEP/STANDARD/LITE 모드 자동 분류)
      const candidatesScored = taggedResult.issues.map(issue => {
        const s = scoreIssueMatrix(issue);
        return { ...issue, score: s.total, scoreBreakdown: s.breakdown };
      });
      const keyIssues = candidatesScored
        .filter(issue => selectedIssueIds.includes(getIssueId(issue)))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (b.durMin || 0) - (a.durMin || 0);
        });

      // 영역 11: 체크 안 된 이슈는 본문 논의 대상 X (사용자 명시 선정만)
      const liteIssues = [];  // 폐기: 사용자가 명시적으로 체크한 것만 분석
      const allTargets = keyIssues;

      const autoCount = keyIssues.filter(i => autoSelectedIds.includes(getIssueId(i))).length;
      const manualCount = keyIssues.length - autoCount;
      setProgress(p => [...p, `🔍 본문 논의: 자동 ${autoCount}건 + 사용자 추가 ${manualCount}건 = 총 ${keyIssues.length}건`]);

      // ★ 영역 6-E: STEP 3에서 미리 실행한 큐레이션 재사용 (재호출 없음)
      const allIssuesForCuration = allIssuesFlat;
      const categoryMsgs = preCategoryMsgs || {
        quality: classified?.qualityMsgs || [],
        process_change: classified?.processChangeMsgs || [],
        test: classified?.testMsgs || [],
      };
      let curation = preCuration;
      if (curation) {
        setProgress(p => [...p, `♻️ PE 큐레이션 재사용 (STEP 3에서 사전 실행됨)`]);
      } else {
        // 폴백: STEP 3 큐레이션이 어떤 이유로든 없으면 여기서 실행
        setProgress(p => [...p, "📝 PE 사전 큐레이션 중 (전체 이슈 정리)..."]);
        try {
          curation = await runPreCuration(allIssuesForCuration, kbResult.kb["Cell_PE"] || kbResult.kb["Elec_PE"] || "", reportType, categoryMsgs);
          setProgress(p => [...p, `✅ PE 큐레이션 완료`]);
        } catch {
          setProgress(p => [...p, `⚠️ PE 큐레이션 실패 - 폴백 사용`]);
          curation = buildFallbackCuration(allIssuesForCuration, categoryMsgs);
        }
      }

      setProgress(p => [...p, `🏷️ 5-카테고리: 장기부동 ${taggedResult.counts.LONG_DOWNTIME} / 반복 ${taggedResult.counts.HIGH_FREQUENCY} / 조건변경 ${taggedResult.counts.CONDITION_CHANGE} / 테스트 ${taggedResult.counts.TEST_PM} / 품질 ${taggedResult.counts.QUALITY_NG}`]);

      // 모드 분류 + 건별 논의 (영역 11: 간단 모드 폐기, 항상 페르소나 논의)
      const allDiscussions = [];

      // 본문 논의 처리 — 영역 11: 사용자 추가 이슈 = DEEP, 자동 선정 = tags 기반
      {
        for (let i = 0; i < keyIssues.length; i++) {
          const issue = keyIssues[i];
          const isAutoSelected = autoSelectedIds.includes(getIssueId(issue));
          const hasLongTag = (issue.tags || []).includes("LONG_DOWNTIME");
          const hasFreqTag = (issue.tags || []).includes("HIGH_FREQUENCY");
          // 영역 11-7-2: 사용자 추가 이슈는 무조건 DEEP
          // 자동 선정 이슈: LONG_DOWNTIME → DEEP, HIGH_FREQUENCY만 → STANDARD
          const modeInfo = !isAutoSelected
            ? { mode: "DEEP", reason: "사용자 추가 (체크박스 선택)", source: "user" }
            : classifyDiscussionMode(issue, hasLongTag, hasFreqTag);
          const mStyle = MODE_STYLE[modeInfo.mode];

          setProgress(p => [...p, `${mStyle.label} [${i+1}/${keyIssues.length}] ${issue.eq} (${modeInfo.reason})`]);

          const result = await runIssueDiscussion(issue, modeInfo, kbResult.kb, reportType, allowedAgents, (msg) => {
            setProgress(p => [...p, `   ${msg}`]);
          });
          allDiscussions.push(result);
          setDiscussions([...allDiscussions]);
        }

        // 영역 11: 사용자가 체크하지 않은 이슈는 본문 논의 안 함 (LITE 루프 폐기)
        // 만약 향후 자동 LITE 처리 추가 원하면 여기에 다시 작성 가능
      }

      // 보고서 생성
      setProgress(p => [...p, "📄 보고서 생성 중..."]);
      // ★ 영역 8-D: selRange가 있으면 풍부한 라벨 사용, 없으면 기존 방식 폴백
      const dateStr = (selRange && selRange.start && selRange.end)
        ? buildRangeLabel(selRange)
        : (selDates.length > 1 ? `${selDates[0]}~${selDates[selDates.length-1]}` : selDates[0]);
      const allIssuesForAnalytics = allIssuesFlat;

      // 영역 11: 단일 흐름 — 페르소나 보고서 생성
      // generateReport는 priority 객체를 기대하지만 평면 배열도 받도록 호환 처리
      // (우선 평면 배열을 priority 형태로 wrap해서 호환 — 기존 generateReport 시그니처 유지)
      const priorityCompat = {
        urgent: keyIssues.filter(i => (i.tags || []).includes("LONG_DOWNTIME")),
        important: keyIssues.filter(i => (i.tags || []).includes("HIGH_FREQUENCY") && !(i.tags || []).includes("LONG_DOWNTIME")),
        normal: [],
      };

      // ★ 영역 11-E + 12-AI1: 6번 "가장 주목할 사항" + 7번 "액션 후속 사항" 생성 (Sonnet + raw 메시지)
      setProgress(p => [...p, "💡 6번 인사이트 + 7번 액션 후속 사항 생성 중 (Sonnet 사건 단위)..."]);
      let insightsAndActions = { section6_insights: [], section7_actions: [] };
      try {
        insightsAndActions = await generateInsightsAndActions(
          curation, allDiscussions, taggedResult,
          kbResult.kb["Cell_PE"] || kbResult.kb["Elec_PE"] || "",
          reportType, categoryMsgs  // ★ AI1: raw 메시지 전달
        );
        setProgress(p => [...p, `✅ 인사이트 ${insightsAndActions.section6_insights.length}건 / 액션 ${insightsAndActions.section7_actions.length}건 생성 완료`]);
      } catch (e) {
        console.error("[6/7번 생성 실패]", e);
        setProgress(p => [...p, `⚠️ 6/7번 LLM 생성 실패 — 룰 기반 폴백 사용`]);
        insightsAndActions = buildFallbackInsightsAndActions(curation, taggedResult);
      }

      const report = await generateReport(dateStr, selDates, allDiscussions, priorityCompat, reportType, kbResult.kb, allIssuesForAnalytics, selectedProcess, curation);
      // ★ 보고서에 공정/참여 에이전트 정보 추가
      report.process = selectedProcess;
      report.allowedAgents = allowedAgents;
      report.range = selRange;  // 영역 8: 보고서에 범위 정보 보존
      report.tagged = taggedResult;  // 영역 9: 5-카테고리 결과 보존
      // ★ 영역 11-E: 6/7번 결과 보존
      report.insights = insightsAndActions.section6_insights;
      report.actions = insightsAndActions.section7_actions;
      report.curation = curation;  // 메인 페이지에서 1~5번 표시 위해
      report.discussions = allDiscussions;  // ★ Phase 2: 페르소나 매칭용
      setMinutes(report);

      // 시트 저장 — 영역 12-X5 (3): 새 4축 필드 + 페르소나 say 통합 컬럼
      setProgress(p => [...p, "💾 구글 시트 저장 중..."]);

      // 사회자 4축 합의 + say 통합 (DEEP/STANDARD/LITE)
      const buildSheetSummary = (group, mode) => {
        return (group || []).map(d => {
          const m = d.moderator || {};
          const eq = d.issue?.eq || "?";
          // 4축 합의 (있으면 우선)
          const axes = [
            m["근본원인_합의"] && `근본원인:${m["근본원인_합의"].slice(0, 60)}`,
            m["조치안_평가_합의"] && `조치평가:${m["조치안_평가_합의"].slice(0, 60)}`,
            m["개선안_합의"] && `개선:${m["개선안_합의"].slice(0, 60)}`,
            m["재발방지책_합의"] && `재발방지:${m["재발방지책_합의"].slice(0, 60)}`,
          ].filter(Boolean).join(" / ");
          // 4축 없으면 옛 호환
          const fallback = m.consensus || m.summary || m.supplement || "-";
          return `[${eq}] ${axes || fallback}`;
        }).join(" || ");
      };

      const deepSummary = buildSheetSummary(report.grouped?.DEEP, "DEEP");
      const stdSummary = buildSheetSummary(report.grouped?.STANDARD, "STANDARD");
      const liteSummary = buildSheetSummary(report.grouped?.LITE, "LITE");

      // 페르소나 say 발언 통합 (모든 discussion에서 say 추출)
      const personaSayCombined = (allDiscussions || []).map(d => {
        const eq = d.issue?.eq || "?";
        const says = (d.opinions || []).map(o => {
          const p = PERSONAS[o.persona]?.label || o.persona;
          const say = (o.opinion?.say || o.opinion?.근본원인 || "").slice(0, 100);
          return say ? `${p}: ${say}` : null;
        }).filter(Boolean).join(" | ");
        return says ? `[${eq}] ${says}` : null;
      }).filter(Boolean).join(" || ").slice(0, 1500);

      const saved = await saveToSheets({
        date: dateStr,
        agenda: `[${selectedProcess} 공정] ${report.agenda}`,
        issue_summary: `5-카테고리 LD${taggedResult.counts.LONG_DOWNTIME}/HF${taggedResult.counts.HIGH_FREQUENCY}/CC${taggedResult.counts.CONDITION_CHANGE}/TP${taggedResult.counts.TEST_PM}/QN${taggedResult.counts.QUALITY_NG} | 본문논의 ${keyIssues.length}건 (자동 ${autoCount} + 사용자 추가 ${manualCount}) | DEEP${report.grouped.DEEP.length} STANDARD${report.grouped.STANDARD.length} LITE${report.grouped.LITE.length}`,
        pe_opinion: deepSummary.slice(0, 800),  // 4축 통합 (이전 500 → 800 확대)
        me_opinion: stdSummary.slice(0, 800),
        te_opinion: liteSummary.slice(0, 500),
        discussion: personaSayCombined,  // ★ 페르소나 say 통합 (영역 12-X5)
        action_items: (report.actions || []).map(a => `[${a.priority}] ${a.action}`).join(" | ").slice(0, 800),  // 7번 액션
        minutes_full: JSON.stringify({
          process: selectedProcess,
          agents: allowedAgents,
          analytics: report.analytics,
          modeStats: { DEEP: report.grouped.DEEP.length, STANDARD: report.grouped.STANDARD.length, LITE: report.grouped.LITE.length },
          tagged: taggedResult.counts,
          insightsCount: (report.insights || []).length,
          actionsCount: (report.actions || []).length,
        }).slice(0, 1500),
      });
      setSheetSaved(saved);
      setStep(4);
      setProgress(p => [...p, "✅ 완료!"]);

    } catch(e) { setError(e.message); }
    finally { setRunning(false); }
  };

  // ─── ★ 영역 12-AK: Teams 자동송부 인프라 (Phase E 사양 14.5 / 14.3 / 14.4) ────────
  // α: 수동 버튼 (Phase B/C/D 독립 — 즉시 동작)
  // β: 알람 룰 4종 골격 (Phase B 후 활성화)
  // γ: 일일 레포트 골격 (Phase D 후 활성화)
  // 보안: Webhook URL은 클라이언트 미보유 — Apps Script Properties Service 경유

  // 12-AK-1: 메인 레포트 → 단순 텍스트 변환 (Q3=a, 최소 변환)
  const reportToTeamsText = () => {
    if (!minutes) return "";
    const cur = minutes.curation || {};
    const insights = minutes.insights || [];
    const actions = minutes.actions || [];
    const tagged = minutes.tagged || { issues: [], counts: {} };
    const issuesCount = (tagged.issues || []).length;
    const long30 = (cur.longDowntime || []).filter(it => Number(it.duration || it.durMin || 0) >= 30);
    const lines = [];

    // 헤더
    lines.push(`📊 *${minutes.title || "AZS Factory 일일 이슈 레포트"}*`);
    lines.push(`📅 ${minutes.date || "-"}`);
    lines.push("");

    // 핵심 요약
    if (cur.summary_text) {
      lines.push(`📋 *핵심 요약*`);
      lines.push(cur.summary_text);
      lines.push("");
    }
    if ((cur.criticalSummary || []).length > 0) {
      lines.push(`⚠️ *중요 사항*`);
      cur.criticalSummary.forEach(c => lines.push(`• ${c}`));
      lines.push("");
    }

    // 통계
    lines.push(`📈 *통계*`);
    lines.push(`• 전체 부동: ${issuesCount}건`);
    lines.push(`• 30분+ 장기부동: ${long30.length}건`);
    if ((cur.recurringByCategory || []).length > 0) lines.push(`• 반복 카테고리: ${cur.recurringByCategory.length}개`);
    if ((cur.conditionChangeGroups || []).length > 0) lines.push(`• 조건 변경 그룹: ${cur.conditionChangeGroups.length}개`);
    lines.push("");

    // TOP 5 (score 기준, scored 결과 → tagged.issues에서 score 보유)
    const scoredIssues = (tagged.issues || []).filter(it => typeof it.score === "number").sort((a, b) => b.score - a.score).slice(0, 5);
    if (scoredIssues.length > 0) {
      lines.push(`🚨 *핵심 이슈 TOP ${scoredIssues.length}*`);
      scoredIssues.forEach((it, i) => {
        const eq = it.eq || it.equipment || "?";
        const prob = (it.problem || it.text || "").slice(0, 60);
        const dur = it.durMin || it.duration || 0;
        lines.push(`${i + 1}. [${it.score}점] ${eq} — ${prob}${dur ? ` (${dur}분)` : ""}`);
      });
      lines.push("");
    }

    // 인사이트
    if (insights.length > 0) {
      lines.push(`💡 *주목할 사항*`);
      insights.slice(0, 5).forEach((ins, i) => {
        const text = typeof ins === "string" ? ins : (ins.text || ins.content || JSON.stringify(ins));
        lines.push(`${i + 1}. ${text.slice(0, 200)}`);
      });
      lines.push("");
    }

    // 액션 (P0 위주)
    const p0Actions = actions.filter(a => a.priority === "P0");
    const p1Actions = actions.filter(a => a.priority === "P1");
    if (p0Actions.length > 0 || p1Actions.length > 0) {
      lines.push(`📌 *액션 후속 (P0/P1)*`);
      [...p0Actions, ...p1Actions].slice(0, 6).forEach(a => {
        lines.push(`• [${a.priority}] ${a.action} ${a.context ? `— ${a.context}` : ""}`);
      });
      lines.push("");
    }

    lines.push(`— ESHM AI 공유방 자동 발송 · ${new Date().toLocaleString("ko-KR")}`);
    return lines.join("\n");
  };

  // 12-AK-2: Teams 발송 핸들러 (Apps Script proxy POST)
  const [teamsSending, setTeamsSending] = useState(false);
  const [teamsResult, setTeamsResult] = useState(null);  // {ok, msg}
  const sendToTeams = async () => {
    if (!minutes || teamsSending) return;
    const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || "";
    const SHARED_SECRET = import.meta.env.VITE_TEAMS_SHARED_SECRET || "";
    if (!APPS_SCRIPT_URL) {
      setTeamsResult({ ok: false, msg: "VITE_APPS_SCRIPT_URL 환경변수 미설정 — SETUP.md 참조" });
      setTimeout(() => setTeamsResult(null), 5000);
      return;
    }
    setTeamsSending(true);
    setTeamsResult(null);
    try {
      const text = reportToTeamsText();
      const payload = {
        action: "send_report",
        secret: SHARED_SECRET,
        text,
        title: minutes.title || "AZS 일일 이슈 레포트",
        date: minutes.date || "",
        meta: {
          issuesCount: (minutes.tagged?.issues || []).length,
          insightsCount: (minutes.insights || []).length,
          actionsCount: (minutes.actions || []).length,
        },
      };
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        // Apps Script Web App: text/plain로 전송 (CORS preflight 우회)
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTeamsResult({ ok: true, msg: "✅ Teams 채널에 발송 완료" });
      } else {
        setTeamsResult({ ok: false, msg: `❌ 발송 실패: ${data.error || res.status}` });
      }
    } catch (e) {
      setTeamsResult({ ok: false, msg: `❌ 네트워크 오류: ${e?.message || e}` });
    } finally {
      setTeamsSending(false);
      setTimeout(() => setTeamsResult(null), 6000);
    }
  };

  // 12-AK-3: 알람 룰 4종 골격 (β — Phase B 실시간 데이터 후 활성화)
  // 입력: 신규 메시지 1건 + 현재 누적 부동 상태
  // 출력: 발송할 알람 텍스트 배열 (없으면 빈 배열)
  // eslint-disable-next-line no-unused-vars
  const evaluateAlarmRules = (msg, contextState = {}) => {
    if (!msg || typeof msg.text !== "string") return [];
    const alarms = [];
    const text = msg.text.toLowerCase();

    // 룰 1: 안전·환경 키워드
    const SAFETY_KEYWORDS = ["위험", "사고", "fire", "환경", "safety", "danger", "emergency", "injury"];
    if (SAFETY_KEYWORDS.some(kw => text.includes(kw))) {
      alarms.push({ rule: "safety", level: "🚨", text: `🚨 안전·환경 키워드 감지\n${msg.text.slice(0, 300)}` });
    }
    // 룰 2: 장기부동 60분↑
    const dur = Number(msg.durMin || msg.duration || 0);
    if (dur >= 60) {
      alarms.push({ rule: "long_downtime", level: "🚨", text: `🚨 장기부동 ${dur}분\n${msg.equipment || "?"} — ${msg.problem || msg.text}` });
    }
    // 룰 3: Full Stop
    if (/full[\s_]?stop/i.test(msg.text)) {
      alarms.push({ rule: "full_stop", level: "🚨", text: `🚨 Full Stop 발생\n${msg.text.slice(0, 300)}` });
    }
    // 룰 4: 점수 임계값 (잠정 20, Phase E 시작 시 시뮬레이션 후 확정)
    const SCORE_THRESHOLD = 20;
    if (typeof msg.score === "number" && msg.score >= SCORE_THRESHOLD) {
      alarms.push({ rule: "high_score", level: "🚨", text: `🚨 고위험 점수 ${msg.score}점\n${msg.equipment || "?"} — ${msg.problem || msg.text}` });
    }
    return alarms;
  };

  // 12-AK-4: 일일 레포트 텍스트 변환 (γ — Phase D Sheets 데이터 후 활성화)
  // cron 07:00 호출용 — Apps Script 측에서 자체 분석 후 호출하므로 이 함수는 React 측 미호출
  // 골격만 유지 (스펙 가이드 역할)
  // eslint-disable-next-line no-unused-vars
  const composeDailyReport = (analysisResult) => {
    // analysisResult: Phase D에서 Sheets 조회 후 분석한 결과 (현재 minutes와 동일 구조 가정)
    // 향후 Apps Script 또는 Netlify Function이 React 분석 로직을 호출 → 이 함수에 주입 → 텍스트 반환
    if (!analysisResult) return "";
    // 임시: reportToTeamsText와 동일 로직 재사용 가능 (Phase D 시점에 분기)
    return "[Phase D 후 활성화] 일일 레포트 자동 생성 골격";
  };

  // ─── ★ 영역 11-H: HTML 다운로드 (메인 1~7번) ──────────────────────────────────
  const downloadHtml = () => {
    if (!minutes) return;
    const title = minutes.title || "AZS Factory 일일 이슈 레포트";
    const cur = minutes.curation || {};
    const insights = minutes.insights || [];
    const actions = minutes.actions || [];
    const periodLabel = minutes.date || "";
    const tagged = minutes.tagged || { issues: [], counts: {} };
    const issuesCount = (tagged.issues || []).length;

    // 헬퍼: HTML 이스케이프
    const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    // ★ 영역 12-AL: 중복 제거 — 동일 discussion이 여러 섹션에 표시되지 않도록 Set으로 추적
    // 우선순위: 1번 장기부동 > 2번 큰 그룹 > 2번 작은 그룹 > 3,4번 영역 > 5번 품질 NG > 7번 액션
    const printedDiscussionIds = new Set();
    const discussionIdOf = (d) => {
      if (!d || !d.issue) return null;
      const eq = d.issue.eq || "?";
      const dur = d.issue.durMin || 0;
      const text = (d.issue.problem || d.issue.text || "").slice(0, 30);
      return `${eq}|${dur}|${text}`;
    };
    const isAlreadyPrinted = (d) => {
      const id = discussionIdOf(d);
      return id && printedDiscussionIds.has(id);
    };
    const markPrinted = (d) => {
      const id = discussionIdOf(d);
      if (id) printedDiscussionIds.add(id);
    };

    // ★ Phase 2: 페르소나 대화 HTML 생성 헬퍼 (좌우 번갈아 + 색상 + 인용구 + 사회자 종합)
    // 12-AL: 표시 즉시 markPrinted 호출 → 중복 표시 방지
    const buildPersonaConvHtml = (matched) => {
      if (!matched) return "";
      markPrinted(matched);  // ★ 12-AL: 표시 추적
      const opinions = matched.opinions || [];
      const m = matched.moderator || {};
      const mode = matched.modeInfo?.mode || "?";

      // 입장 색상
      const stanceColors = {
        "동의": "#27ae60", "부분동의": "#d68910", "반대": "#c0392b",
        "추가의견": "#7c3aed", "초기분석": "#2980b9",
      };
      const stanceBg = {
        "동의": "rgba(39,174,96,0.15)", "부분동의": "rgba(214,137,16,0.15)",
        "반대": "rgba(192,57,43,0.15)", "추가의견": "rgba(124,58,237,0.15)",
        "초기분석": "rgba(41,128,185,0.15)",
      };

      // 메시지 (좌우 번갈아)
      const messages = opinions.map((o, idx) => {
        const p = PERSONAS[o.persona] || {};
        const op = o.opinion || {};
        const isLeft = idx % 2 === 0;
        const stance = op.stance || "초기분석";
        const sayText = op.say || op.근본원인 || "(발언 데이터 없음)";
        const quote = op.quote || op.previous_reference || "";
        const replyTo = op.reply_to || "";
        const stanceColor = stanceColors[stance] || "#7f8c8d";
        const stanceBgColor = stanceBg[stance] || "rgba(127,140,141,0.15)";
        const personaColor = p.color || "#7f8c8d";
        const personaBgColor = p.bg || "rgba(127,140,141,0.15)";

        const align = isLeft ? "flex-start" : "flex-end";
        const flexDir = isLeft ? "row" : "row-reverse";
        const radius = isLeft ? "4px 14px 14px 14px" : "14px 4px 14px 14px";

        const nameLabels = `
          <span style="font-weight:700;color:${personaColor};">${esc(p.label || o.persona)}</span>
          <span style="font-size:0.85em;padding:1px 6px;border-radius:8px;background:${stanceBgColor};color:${stanceColor};font-weight:700;">${esc(stance)}</span>
          ${replyTo ? `<span style="font-size:0.85em;padding:1px 6px;border-radius:8px;background:#ecf0f1;color:#7f8c8d;">↩ ${esc(replyTo)}</span>` : ""}
        `;

        const bubbleContent = `
          ${quote ? `<div style="font-size:0.85em;font-style:italic;padding:4px 10px;margin-bottom:6px;border-left:3px solid rgba(0,0,0,0.3);background:rgba(0,0,0,0.18);border-radius:0 8px 8px 0;color:rgba(255,255,255,0.85);">"${esc(quote)}"</div>` : ""}
          <div>${esc(sayText)}</div>
        `;

        return `
        <div style="display:flex;flex-direction:${flexDir};margin-bottom:14px;gap:8px;justify-content:${align};">
          <div style="flex-shrink:0;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;background:${personaBgColor};color:${personaColor};">
            ${esc(p.icon || "?")}
          </div>
          <div style="max-width:70%;text-align:${isLeft ? "left" : "right"};">
            <div style="font-size:0.8em;margin-bottom:4px;display:flex;gap:6px;align-items:center;justify-content:${isLeft ? "flex-start" : "flex-end"};flex-wrap:wrap;">
              ${nameLabels}
            </div>
            <div style="padding:10px 14px;border-radius:${radius};font-size:0.92em;line-height:1.6;background:${personaColor};color:white;text-align:left;">
              ${bubbleContent}
            </div>
          </div>
        </div>`;
      }).join("");

      // 사회자 종합
      const modParts = [];
      if (m["근본원인_합의"]) modParts.push(`<div style="margin:5px 0;"><b style="color:#c0392b;display:inline-block;min-width:130px;">🎯 근본원인 합의:</b> ${esc(m["근본원인_합의"])}</div>`);
      if (m["조치안_평가_합의"]) modParts.push(`<div style="margin:5px 0;"><b style="color:#e67e22;display:inline-block;min-width:130px;">⚖️ 조치안 평가:</b> ${esc(m["조치안_평가_합의"])}</div>`);
      if (m["개선안_합의"]) modParts.push(`<div style="margin:5px 0;"><b style="color:#2980b9;display:inline-block;min-width:130px;">💡 개선안 합의:</b> ${esc(m["개선안_합의"])}</div>`);
      if (m["재발방지책_합의"]) modParts.push(`<div style="margin:5px 0;"><b style="color:#27ae60;display:inline-block;min-width:130px;">🛡️ 재발방지책:</b> ${esc(m["재발방지책_합의"])}</div>`);
      if (m["충돌점"] && m["충돌점"] !== "없음") modParts.push(`<div style="margin:5px 0;"><b style="color:#c0392b;display:inline-block;min-width:130px;">⚠️ 충돌점:</b> ${esc(m["충돌점"])}</div>`);
      if (m["추가_논의_필요"] && m["추가_논의_필요"] !== "없음") modParts.push(`<div style="margin:5px 0;"><b style="color:#e67e22;display:inline-block;min-width:130px;">🔍 추가 논의:</b> ${esc(m["추가_논의_필요"])}</div>`);
      if (Array.isArray(m.actions) && m.actions.length > 0) {
        const actsHtml = m.actions.map(a => `<li><b>[${esc(a.priority || "-")}]</b> ${esc(a.action || "")} <span style="color:#666;">(${esc(a.owner || "-")} / ${esc(a.duration || "-")})</span></li>`).join("");
        modParts.push(`<div style="margin-top:8px;"><b style="color:#2980b9;">📋 액션 플랜:</b><ul style="margin:4px 0;padding-left:20px;">${actsHtml}</ul></div>`);
      }
      if (m.consensus) modParts.push(`<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(124,58,237,0.2);font-style:italic;color:#7c3aed;">💬 ${esc(m.consensus.slice(0, 200))}</div>`);

      return `
        <details style="margin-top:12px;padding-top:12px;border-top:1px dashed #bbb;">
          <summary style="cursor:pointer;padding:6px 10px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.25);border-radius:6px;font-weight:700;color:#7c3aed;">
            💬 페르소나 논의 (${opinions.length}명 발언) · ${esc(mode)} 모드 · 사회자 종합 포함
          </summary>
          <div style="padding:14px 4px;">
            ${messages}
          </div>
          <div style="margin-top:12px;padding:14px 18px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.3);border-left:5px solid #7c3aed;border-radius:8px;">
            <div style="color:#7c3aed;font-weight:700;margin-bottom:8px;">📋 사회자 종합 (${esc(mode)})</div>
            ${modParts.join("")}
          </div>
        </details>
      `;
    };

    // discussions 매칭 헬퍼 (downloadHtml 안에서 사용)
    const findMatchingDiscForCuration = (item) => {
      const ds = minutes.discussions || [];
      if (!item || !item.equipment) return null;
      let m = ds.find(d => d.issue?.eq === item.equipment && item.durationMin && Math.abs((d.issue?.durMin || 0) - item.durationMin) < 5);
      if (m) return m;
      return ds.filter(d => d.issue?.eq === item.equipment).sort((a, b) => (b.issue?.durMin || 0) - (a.issue?.durMin || 0))[0] || null;
    };

    // 1번 장기부동 박스 — 영역 12-Y1: 새 필드 (splitDetail, recurrenceGap, collateralDamage, historyPattern, actionAnalysis)
    const longDowntimeHtml = (cur.longDowntime || []).map((d) => {
      const matchedDisc = findMatchingDiscForCuration(d);
      const personaConvHtml = buildPersonaConvHtml(matchedDisc);

      // 분할 보고 정밀 분석
      const splitDetailHtml = (d.splitDetail || []).length > 0 ? `
        <div style="margin-top:8px;padding:8px 12px;background:#fffbe6;border-left:3px solid #fbbf24;border-radius:4px;">
          <div style="font-weight:700;color:#d97706;margin-bottom:4px;">📊 분할 보고 분석</div>
          ${d.splitDetail.map(sd => `
            <div style="font-size:0.92em;margin-bottom:3px;padding-left:8px;">
              <b style="color:#e67e22;">${sd.order}차</b> — <b>${sd.duration}분</b> (${esc(sd.time)})
              ${sd.gapMin ? `<span style="color:#c0392b;margin-left:6px;font-weight:700;">· 1차 후 ${sd.gapMin}분만에 재발</span>` : ""}
              ${sd.description ? `<div style="margin-top:1px;color:#666;">→ ${esc(sd.description)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      ` : "";

      // 재발 간격 (단독)
      const recurrenceGapHtml = (d.recurrenceGap && !(d.splitDetail || []).length) ? `
        <div style="margin-top:6px;padding:6px 10px;background:#fffbe6;border-left:3px solid #fbbf24;border-radius:4px;color:#d97706;font-weight:700;">
          ⏱️ ${esc(d.recurrenceGap)}
        </div>
      ` : "";

      // 이력 패턴
      const historyPatternHtml = d.historyPattern ? `
        <div style="margin-top:6px;padding:6px 10px;background:#f0e6ff;border-left:3px solid #a78bfa;border-radius:4px;font-size:0.92em;">
          <b style="color:#7c3aed;">🔍 이력 패턴:</b> ${esc(d.historyPattern)}
        </div>
      ` : "";

      // 조치 분석
      const actionAnalysisHtml = d.actionAnalysis ? `
        <div style="margin-top:6px;padding:6px 10px;background:#fff5f5;border-left:3px solid #c0392b;border-radius:4px;font-size:0.92em;color:#c0392b;font-style:italic;">
          ⚠️ ${esc(d.actionAnalysis)}
        </div>
      ` : "";

      return `
      <div class="${d.isTop ? "critical" : "warning"}">
        <h3 style="margin-top:0;">${d.isTop ? "🔴 [TOP] " : "🔴 "}${esc(d.title || `${d.equipment} ${d.durationMin}분`)}</h3>
        <table>
          <tbody>
            ${d.occurrence ? `<tr><th style="width:25%;">발생</th><td>${esc(d.occurrence)}</td></tr>` : ""}
            ${d.alarm ? `<tr><th>알람</th><td><code>${esc(d.alarm)}</code></td></tr>` : ""}
            ${d.splitNote ? `<tr><th>보고 형태</th><td><b>${esc(d.splitNote)}</b></td></tr>` : ""}
            ${d.rootCause ? `<tr><th>근본 원인</th><td><b>${esc(d.rootCause)}</b></td></tr>` : ""}
            ${d.partReplaced ? `<tr><th>부품 교체</th><td><b>${esc(d.partReplaced)}</b></td></tr>` : ""}
            ${d.collateralDamage ? `<tr><th>부수 피해</th><td><b style="color:#d97706;">${esc(d.collateralDamage)}</b></td></tr>` : ""}
            ${d.pic ? `<tr><th>PIC</th><td>${esc(d.pic)}</td></tr>` : ""}
            ${d.result ? `<tr><th>결과</th><td><span class="${(d.result || "").toLowerCase().includes("solved") ? "ok" : "progress"}">${esc(d.result)}</span></td></tr>` : ""}
          </tbody>
        </table>
        ${splitDetailHtml}
        ${recurrenceGapHtml}
        ${historyPatternHtml}
        ${(d.actionSequence || []).length > 0 ? `
        <h4>적용 조치 (${d.actionSequence.length}단계)</h4>
        <ol>${d.actionSequence.map(s => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
        ${actionAnalysisHtml}
        ${personaConvHtml}
      </div>
    `;
    }).join("");

    // ★ 영역 12-Y4: 만성 이슈 별도 섹션 HTML
    const chronicIssuesHtml = (cur.chronicIssues || []).length > 0 ? `
      <hr>
      <h2>🔥 만성 이슈 추적 (별도)</h2>
      <p class="meta">24시간 이상 open 상태이거나 여러 일자에 걸쳐 반복되는 만성 이슈입니다.</p>
      ${(cur.chronicIssues).map(c => `
        <div class="critical">
          <h3 style="margin-top:0;">⚠️ ${esc(c.title || c.equipment || "")}</h3>
          <table>
            <tbody>
              ${c.startedAt ? `<tr><th style="width:22%;">시작</th><td>${esc(c.startedAt)}</td></tr>` : ""}
              ${c.currentStatus ? `<tr><th>현재 상태</th><td><b style="color:#d97706;">${esc(c.currentStatus)}</b></td></tr>` : ""}
              ${c.managerInvolved ? `<tr><th>관련 관리</th><td><b style="color:#c0392b;">${esc(c.managerInvolved)}</b></td></tr>` : ""}
            </tbody>
          </table>
          ${(c.history || []).length > 0 ? `<h4>이력</h4><ul>${c.history.map(h => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}
        </div>
      `).join("")}
    ` : "";

    // ★ 영역 12-Y2: 조건변경 그룹 HTML
    const conditionChangeGroupsHtml = (cur.conditionChangeGroups || []).length > 0 ? `
      ${(cur.conditionChangeGroups).map(g => `
        <h3>${esc(g.title || g.equipment || "")}${g.timeRange ? ` <span style="font-weight:400;color:#666;font-size:0.85em;">(${esc(g.timeRange)}${g.shift ? `, ${esc(g.shift)}` : ""})</span>` : ""}</h3>
        ${g.picReason ? `<p class="meta">${esc(g.picReason)}</p>` : ""}
        ${(g.parameters || []).length > 0 ? `
          <table>
            <thead><tr><th>파라미터</th><th>Before → After</th></tr></thead>
            <tbody>
              ${g.parameters.map(p => `<tr><td>${esc(p.parameter)}</td><td>${esc(p.before)} → <b>${esc(p.after)}</b></td></tr>`).join("")}
            </tbody>
          </table>
        ` : ""}
        ${g.verification ? `<p>→ <b class="ok">${esc(g.verification)}</b></p>` : ""}
      `).join("")}
    ` : "";

    // ★ 영역 12-Y3: 1AB 만성 라인 HTML
    const chronic1ABHtml = cur.chronic1AB && (cur.chronic1AB.title || (cur.chronic1AB.byEquipment || []).length) ? `
      <div class="critical" style="margin-top:1em;">
        <h3 style="margin-top:0;">🔥 ${esc(cur.chronic1AB.title || "Stacking 1-AB Sepa Run Issues (지속 모니터링)")}</h3>
        ${cur.chronic1AB.patternSummary ? `<p>→ <i>${esc(cur.chronic1AB.patternSummary)}</i></p>` : ""}
        ${(cur.chronic1AB.byEquipment || []).length > 0 ? `
          <table>
            <thead><tr><th>호기</th><th>다발 NG</th></tr></thead>
            <tbody>
              ${cur.chronic1AB.byEquipment.map(e => `<tr><td><b>${esc(e.equipment)}</b></td><td class="fail">${esc(e.ngList)}</td></tr>`).join("")}
            </tbody>
          </table>
        ` : ""}
      </div>
    ` : "";

    // ★ 영역 12-Y3: Line 3D Cutter CPC HTML
    const line3DCutterCpcHtml = cur.line3DCutterCpc && cur.line3DCutterCpc.status ? `
      <div class="info" style="margin-top:1em;">
        <h4 style="margin-top:0;">📡 Line 3D Cutter CPC 이상 (모니터링)</h4>
        <p>${esc(cur.line3DCutterCpc.status)}</p>
        ${(cur.line3DCutterCpc.details || []).length > 0 ? `<ul>${cur.line3DCutterCpc.details.map(d => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
      </div>
    ` : "";

    // ★ 영역 12-X6 (1) → 12-AL: 2~5번 섹션 매칭 페르소나 논의 헬퍼 (그룹 단위 통합) ───
    const findDiscussionsByEquipments = (equipments) => {
      const ds = minutes.discussions || [];
      if (!ds.length || !equipments?.length) return [];
      const eqSet = new Set(equipments.map(e => String(e || "").replace(/\s*\(×\d+\)/g, "").trim()).filter(Boolean));
      return ds.filter(d => eqSet.has(d.issue?.eq || ""));
    };
    const findDiscussionsByEquipment = (equipment) => {
      const ds = minutes.discussions || [];
      if (!ds.length || !equipment) return [];
      return ds.filter(d => d.issue?.eq === equipment);
    };

    // ★ 12-AL D2-c: 그룹 단위 표시 — 미표시 멤버 중 가장 부동시간 긴 1개를 대표로 표시
    // + 그룹의 다른 멤버는 "이 그룹의 다른 N건은 [위치] 참조" 안내만 추가
    const buildGroupRepresentativeConv = (matches, groupLabel = "이 그룹") => {
      if (!matches?.length) return "";
      // 미표시 멤버만 필터
      const unprinted = matches.filter(m => !isAlreadyPrinted(m));
      // 이미 표시된 멤버 수
      const alreadyShown = matches.length - unprinted.length;

      if (unprinted.length === 0) {
        // 전부 다른 섹션에서 표시됨 → 안내만
        return `<div style="margin-top:8px;padding:8px 12px;background:#f5f5f5;border-left:3px solid #94a3b8;border-radius:4px;font-size:0.88em;color:#64748b;">📌 ${esc(groupLabel)}의 페르소나 논의 ${matches.length}건은 모두 1번 장기부동 또는 상위 섹션에 표시되었습니다.</div>`;
      }

      // 대표 1개: 미표시 중 가장 부동시간 긴 것
      const rep = unprinted.sort((a, b) => (b.issue?.durMin || 0) - (a.issue?.durMin || 0))[0];
      const repEq = rep.issue?.eq || "?";
      const repDur = rep.issue?.durMin || 0;

      // 미표시 나머지도 markPrinted 처리 (이번 그룹에서 다 다뤘다고 간주)
      unprinted.forEach(m => { if (m !== rep) markPrinted(m); });

      // 안내 메시지
      const noticeParts = [];
      if (matches.length > 1) {
        noticeParts.push(`이 ${esc(groupLabel)}는 총 ${matches.length}건 (대표: ${esc(repEq)} ${repDur}분)`);
      }
      if (alreadyShown > 0) {
        noticeParts.push(`${alreadyShown}건은 1번 장기부동 또는 상위 섹션에 표시됨`);
      }
      if (unprinted.length > 1) {
        const others = unprinted.filter(m => m !== rep).map(m => `${m.issue?.eq}(${m.issue?.durMin}분)`).join(", ");
        noticeParts.push(`다른 ${unprinted.length - 1}건은 동일 패턴으로 간주: ${others}`);
      }

      const noticeHtml = noticeParts.length > 0
        ? `<div style="margin-bottom:8px;padding:6px 10px;background:#fffbe6;border-left:3px solid #fbbf24;border-radius:4px;font-size:0.87em;color:#92400e;">📋 ${noticeParts.join(" · ")}</div>`
        : "";

      return noticeHtml + buildPersonaConvHtml(rep);
    };

    // 옛 호환 (단일 표시 — 1번 장기부동에서만 사용)
    const buildMultiplePersonaConvs = (matches) => {
      if (!matches?.length) return "";
      // 미표시만 필터링 후 모두 표시 (3,4,5번 영역에서 사용)
      const unprinted = matches.filter(m => !isAlreadyPrinted(m));
      if (unprinted.length === 0) {
        return `<div style="margin-top:6px;padding:6px 10px;background:#f5f5f5;border-left:3px solid #94a3b8;border-radius:4px;font-size:0.85em;color:#64748b;">📌 이 영역의 페르소나 논의 ${matches.length}건은 모두 상위 섹션에 표시되었습니다.</div>`;
      }
      return unprinted.map(m => buildPersonaConvHtml(m)).join("");
    };

    // ★ 12-AL: 그룹 정렬 — 큰 그룹 우선 (C-3), 그래야 큰 그룹의 멤버들이 작은 그룹보다 먼저 등록됨
    const recurringByCategorySorted = [...(cur.recurringByCategory || [])]
      .map(c => ({ ...c, _matches: findDiscussionsByEquipments(c.equipments || []) }))
      .sort((a, b) => (b._matches?.length || 0) - (a._matches?.length || 0));
    const recurringSameEquipmentSorted = [...(cur.recurringSameEquipment || [])]
      .map(e => ({ ...e, _matches: findDiscussionsByEquipment(e.equipment) }))
      .sort((a, b) => (b._matches?.length || 0) - (a._matches?.length || 0));

    // 2번 발생빈도 — 카테고리별 그룹 단위 표시
    const recurringCatHtml = (cur.recurringByCategory || []).length > 0 ? `
      <h3>카테고리별</h3>
      <table>
        <thead><tr><th>카테고리</th><th class="num">건수</th><th>해당 설비</th></tr></thead>
        <tbody>
          ${cur.recurringByCategory.map(c => `<tr><td><b>${esc(c.category)}</b></td><td class="num"><b>${c.count}</b></td><td>${esc((c.equipments || []).join(", "))}</td></tr>`).join("")}
        </tbody>
      </table>
      ${recurringByCategorySorted.map(c => {
        const matches = c._matches || [];
        if (!matches.length) return "";
        const groupLabel = `[${c.category}] 카테고리`;
        const groupConv = buildGroupRepresentativeConv(matches, groupLabel);
        return `<div style="margin-top:8px;padding-left:10px;border-left:3px solid #ddd;"><div style="font-size:0.88em;color:#666;margin-bottom:6px;"><b>📌 ${esc(groupLabel)}</b> 그룹 종합 (대표 1건):</div>${groupConv}</div>`;
      }).join("")}` : "";

    const recurringEqHtml = (cur.recurringSameEquipment || []).length > 0 ? `
      <h3>동일 설비 다발</h3>
      <ul>${cur.recurringSameEquipment.map(e => `<li><b>${esc(e.equipment)}</b>: ${e.count}건${e.detail ? ` — ${esc(e.detail)}` : ""}</li>`).join("")}</ul>
      ${recurringSameEquipmentSorted.map(e => {
        const matches = e._matches || [];
        if (!matches.length) return "";
        const groupLabel = `[${e.equipment}] 호기`;
        const groupConv = buildGroupRepresentativeConv(matches, groupLabel);
        return `<div style="margin-top:8px;padding-left:10px;border-left:3px solid #ddd;"><div style="font-size:0.88em;color:#666;margin-bottom:6px;"><b>📌 ${esc(groupLabel)}</b> 그룹 종합 (대표 1건):</div>${groupConv}</div>`;
      }).join("")}` : "";

    // 3번 조건 변경 — 설비별 매칭 페르소나 논의
    const cc = cur.conditionChanges || {};
    const buildTable = (rows, headers, makeRow) => rows.length === 0 ? "" : `
      <table>
        <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(makeRow).join("")}</tbody>
      </table>`;
    // 3번 영역에서 등장하는 모든 equipment 추출 → 매칭 논의 모음
    const buildConditionChangePersonas = () => {
      const eqs = new Set();
      [...(cc.visionOffset || []), ...(cc.settingChange || []), ...(cc.cutter || []), ...(cc.other || [])].forEach(r => {
        if (r.equipment) eqs.add(r.equipment);
      });
      const matches = findDiscussionsByEquipments([...eqs]);
      if (!matches.length) return "";
      return `<div style="margin-top:10px;padding-left:10px;border-left:3px solid #ddd;"><div style="font-size:0.88em;color:#666;margin-bottom:6px;"><b>📌 조건 변경 영역</b> 관련 페르소나 논의:</div>${buildMultiplePersonaConvs(matches)}</div>`;
    };
    const visionHtml = (cc.visionOffset || []).length > 0 ? `<h3>Vision Offset 적용</h3>${buildTable(cc.visionOffset, ["시간", "설비", "변경 내용", "사유"], r => `<tr><td>${esc(r.date)} ${esc(r.time)}</td><td><b>${esc(r.equipment)}</b></td><td>${esc(r.change)}</td><td>${esc(r.reason || "-")}</td></tr>`)}` : "";
    const settingHtml = (cc.settingChange || []).length > 0 ? `<h3>Setting 변경 (Before → After)</h3>${buildTable(cc.settingChange, ["설비", "파라미터", "Before → After"], r => `<tr><td>${esc(r.equipment || "-")}</td><td>${esc(r.parameter)}</td><td>${esc(r.before)} → <b>${esc(r.after)}</b></td></tr>`)}` : "";
    const cutterHtml = (cc.cutter || []).length > 0 ? `<h3>Cutter 조정</h3>${buildTable(cc.cutter, ["시간", "설비", "변경 내용"], r => `<tr><td>${esc(r.date)} ${esc(r.time)}</td><td><b>${esc(r.equipment)}</b></td><td>${esc(r.change)}</td></tr>`)}` : "";
    const otherHtml = (cc.other || []).length > 0 ? `<h3>기타</h3>${buildTable(cc.other, ["날짜", "설비", "변경 내용", "담당"], r => `<tr><td>${esc(r.date)}</td><td>${esc(r.equipment)}</td><td>${esc(r.change)}</td><td>${esc(r.pic || "-")}</td></tr>`)}` : "";
    const conditionChangePersonasHtml = buildConditionChangePersonas();

    // 4번 테스트/PM — 설비별 매칭 페르소나 논의
    const tp = cur.testPm || {};
    const buildTestPmPersonas = () => {
      const eqs = new Set();
      [...(tp.fmvs || []), ...(tp.cutter || []), ...(tp.stackingSepa || [])].forEach(r => {
        if (r.equipment) eqs.add(r.equipment);
        if (r.equipments) String(r.equipments).split(/[,\s]+/).forEach(eq => eq && eqs.add(eq));
      });
      const matches = findDiscussionsByEquipments([...eqs]);
      if (!matches.length) return "";
      return `<div style="margin-top:10px;padding-left:10px;border-left:3px solid #ddd;"><div style="font-size:0.88em;color:#666;margin-bottom:6px;"><b>📌 테스트/PM 영역</b> 관련 페르소나 논의:</div>${buildMultiplePersonaConvs(matches)}</div>`;
    };
    const linePmHtml = (tp.linePM || []).length > 0 ? `<h3>Line PM 계획</h3>${buildTable(tp.linePM, ["일자", "라인", "상태"], r => `<tr><td>${esc(r.date)}</td><td><b>${esc(r.line)}</b></td><td>${esc(r.status)}</td></tr>`)}` : "";
    const fmvsHtml = (tp.fmvs || []).length > 0 ? `<h3>FMVS (Vision Camera)</h3>${buildTable(tp.fmvs, ["일자", "작업", "대상 설비"], r => `<tr><td>${esc(r.date)}</td><td>${esc(r.action)}</td><td>${esc(r.equipments)}</td></tr>`)}` : "";
    const cutterTestHtml = (tp.cutter || []).length > 0 ? `<h3>Cutter 테스트</h3>${buildTable(tp.cutter, ["시간", "항목", "결과"], r => `<tr><td>${esc(r.date)} ${esc(r.time)}</td><td>${esc(r.item)}</td><td>${esc(r.resultIcon || "")} ${esc(r.note || "")}</td></tr>`)}` : "";
    const stackHtml = (tp.stackingSepa || []).length > 0 ? `<h3>Stacking Sepa Run</h3><ul>${tp.stackingSepa.map(s => `<li><b>${esc(s.date)} ${esc(s.equipment)}</b>: ${esc(s.issue)} ${esc(s.resultIcon || "")}</li>`).join("")}</ul>` : "";
    const testPmPersonasHtml = buildTestPmPersonas();

    // 5번 NG 품질 — 품질 관련 페르소나 논의 (QUALITY_NG tag)
    const qng = cur.qualityNg || {};
    const buildQualityPersonas = () => {
      const ds = minutes.discussions || [];
      const matches = ds.filter(d => (d.issue?.tags || []).includes("QUALITY_NG"));
      if (!matches.length) return "";
      return `<div style="margin-top:10px;padding-left:10px;border-left:3px solid #ddd;"><div style="font-size:0.88em;color:#666;margin-bottom:6px;"><b>📌 품질 NG 영역</b> 관련 페르소나 논의:</div>${buildMultiplePersonaConvs(matches)}</div>`;
    };
    const qualityTableHtml = (qng.table || []).length > 0 ? `
      <table>
        <thead><tr><th>일자</th><th class="num">Sepa Fold</th><th class="num">Electrode Expose</th><th class="num">Non Response</th><th class="num">Dim Overkill</th><th class="num">Contact NG</th></tr></thead>
        <tbody>${qng.table.map(r => `<tr><td>${esc(r.date)}</td><td class="num">${r.sepaFold ?? "-"}</td><td class="num">${r.electrodeExpose ?? "-"}</td><td class="num">${r.nonResponse ?? "-"}</td><td class="num">${r.dimOverkill ?? "-"}</td><td class="num">${r.contactNg ?? "-"}</td></tr>`).join("")}</tbody>
      </table>
      ${qng.trend ? `<div class="info"><b>추세:</b> ${esc(qng.trend)}</div>` : ""}` : "<p>데이터 없음</p>";
    const qualityPersonasHtml = buildQualityPersonas();

    // 6번 인사이트
    const insightsHtml = insights.length > 0 ? insights.map(ins => `
      <h3>${esc(ins.title)}</h3>
      <ul>${(ins.bulletPoints || []).map(bp => `<li>${esc(bp)}</li>`).join("")}</ul>
      <p style="font-size:0.9em;color:#666;">
        <b>${ins.confidence?.includes("가설") ? "🔬 가설 — 검증필요" : "✅ 확실"}</b>
        ${ins.evidence ? ` · 📎 근거: ${esc(ins.evidence)}` : ""}
      </p>`).join("") : "<p>인사이트 없음</p>";

    // 7번 액션
    const actionsHtml = actions.length > 0 ? `
      <table>
        <thead><tr><th class="center" style="width:10%;">우선순위</th><th>항목</th><th>비고</th><th style="width:18%;">근거</th></tr></thead>
        <tbody>${actions.map(a => {
          const pCls = a.priority === "P0" ? "p0" : a.priority === "P1" ? "p1" : "p2";
          const pIcon = a.priority === "P0" ? "🚨" : a.priority === "P1" ? "🔴" : "🟡";
          return `<tr><td class="center"><span class="priority ${pCls}">${pIcon} ${esc(a.priority)}</span></td><td><b>${esc(a.action)}</b>${a._ruleAdjusted ? `<div style="font-size:0.8em;color:#888;">※ ${esc(a._ruleAdjusted)}</div>` : ""}</td><td>${esc(a.context)}${a.confidence?.includes("가설") ? ` <span style="font-size:0.85em;color:#e67e22;">🔬 검증필요</span>` : ""}</td><td style="font-size:0.88em;color:#666;">${esc(a.evidence)}</td></tr>`;
        }).join("")}</tbody>
      </table>` : "<p>액션 항목 없음</p>";

    // 영역 12-AJ: 유첨(페르소나 논의 모아보기) 제거 — 메인 1~5번 섹션의 inline 논의와 중복
    // 페르소나 논의는 메인 섹션 각 이슈의 [💬 페르소나 논의] details 안에 그대로 유지됨

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", "Malgun Gothic", sans-serif;
    max-width: 1100px; margin: 2em auto; padding: 0 1.5em; line-height: 1.65; color: #222; background: #fafafa; }
  h1 { font-size: 1.9em; border-bottom: 3px solid #1a3a5c; padding-bottom: 0.3em; color: #1a3a5c; }
  h2 { font-size: 1.45em; border-bottom: 1px solid #ccc; padding-bottom: 0.25em; margin-top: 2em; color: #1a3a5c; }
  h3 { font-size: 1.18em; margin-top: 1.5em; color: #333; }
  h4 { font-size: 1.02em; margin-top: 1.2em; color: #555; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 0.92em; background: #fff; }
  th, td { border: 1px solid #bbb; padding: 7px 11px; text-align: left; vertical-align: top; }
  th { background: #e8eef5; font-weight: 600; color: #1a3a5c; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-family: "SF Mono", Consolas, monospace; font-size: 0.88em; }
  .meta { color: #666; font-size: 0.92em; }
  .critical { background: #fff5f5; border-left: 5px solid #c0392b; padding: 1em 1.3em; margin: 1.2em 0; border-radius: 3px; }
  .warning { background: #fffaf0; border-left: 5px solid #e67e22; padding: 1em 1.3em; margin: 1em 0; border-radius: 3px; }
  .info { background: #f0f8ff; border-left: 5px solid #2980b9; padding: 0.9em 1.2em; margin: 1em 0; border-radius: 3px; }
  .summary-box { background: #fff; border: 2px solid #1a3a5c; padding: 1em 1.3em; margin: 1.5em 0; border-radius: 5px; }
  .ok { color: #27ae60; font-weight: 600; }
  .progress { color: #d68910; font-weight: 600; }
  .priority { font-weight: 700; }
  .p0 { color: #c0392b; }
  .p1 { color: #e67e22; }
  .p2 { color: #d4ac0d; }
</style>
</head>
<body>

<h1>${esc(title)}</h1>
<p class="meta"><b>분석 기간:</b> ${esc(periodLabel)}<br>
<b>출처:</b> AZS Status Reports WhatsApp 그룹<br>
<b>레코드:</b> ${(() => {
  const rb = cur.recordBreakdown || {};
  const parts = [];
  if (rb.bmDowntime > 0) parts.push(`BM Downtime Bot ${rb.bmDowntime}건`);
  if (rb.ubm > 0) parts.push(`UBM ${rb.ubm}건`);
  if (rb.pdDowntime > 0) parts.push(`PD Downtime ${rb.pdDowntime}건`);
  if (rb.other > 0) parts.push(`기타 ${rb.other}건`);
  return parts.length > 0 ? parts.join(" + ") : `부동 이슈 ${issuesCount}건`;
})()}</p>

${cur.summary_text || (cur.criticalSummary || []).length > 0 ? `
<div class="summary-box">
<h3 style="margin-top:0;">📋 핵심 요약</h3>
${cur.summary_text ? `<p><i>${esc(cur.summary_text)}</i></p>` : ""}
${(cur.criticalSummary || []).length > 0 ? `<ul>${cur.criticalSummary.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
</div>` : ""}

<hr>
<h2>🚨 1. 장기부동 건 — 상세</h2>
${longDowntimeHtml || "<p>장기부동 이슈 없음</p>"}

${chronicIssuesHtml}

<hr>
<h2>🔁 2. 발생빈도 높은 이슈</h2>
${recurringCatHtml}
${recurringEqHtml}

<hr>
<h2>⚙️ 3. 설비/공정 조건 변경</h2>
${conditionChangeGroupsHtml}
${visionHtml}${settingHtml}${cutterHtml}${otherHtml}
${!conditionChangeGroupsHtml && !visionHtml && !settingHtml && !cutterHtml && !otherHtml ? "<p>조건 변경 없음</p>" : ""}
${conditionChangePersonasHtml}

<hr>
<h2>🧪 4. 테스트 / PM 활동</h2>
${linePmHtml}${fmvsHtml}${cutterTestHtml}${stackHtml}
${!linePmHtml && !fmvsHtml && !cutterTestHtml && !stackHtml ? "<p>테스트/PM 활동 없음</p>" : ""}
${line3DCutterCpcHtml}
${chronic1ABHtml}
${testPmPersonasHtml}

<hr>
<h2>📊 5. 일일 NG 품질 실적</h2>
${qualityTableHtml}
${qualityPersonasHtml}

<hr>
<h2>⚠️ 6. 가장 주목할 사항</h2>
${insightsHtml}

<hr>
<h2>📌 7. 액션 후속 사항</h2>
${actionsHtml}

<hr>
<p class="meta" style="text-align:center;">— 레포트 종료 —<br>
AZS Status Reports WhatsApp 데이터 기반 · ${new Date().toLocaleString("ko-KR")}</p>

</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${minutes.title || "AZS_레포트"}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadTxt = () => {
    if (!minutes) return;
    let t = `${"═".repeat(52)}\n${minutes.title}\n${"═".repeat(52)}\n`;
    t += `일시: ${minutes.date}\n참석: ${minutes.attendees}\n안건: ${minutes.agenda}\n`;
    if (minutes.process && minutes.allowedAgents) {
      t += `대상 공정: ${PROCESSES[minutes.process]?.label || minutes.process}\n`;
      if (true) {  // 영역 11: 항상 페르소나 정보 출력
        t += `참여 에이전트 (${minutes.allowedAgents.length}명): ${minutes.allowedAgents.map(a => `${a}(${PERSONAS[a]?.label})`).join(", ")}\n`;
      } else {
        t += `생성 모드: 간단 (페르소나 논의 없음)\n`;
      }
    }

    // ★ 영역 9-E: 간단모드 전용 출력
    if (false) {  // 영역 11: 간단모드 TXT 분기 폐기
      const s = minutes.simple;
      t += `\n${"═".repeat(52)}\n📋 카테고리 분류 요약\n${"═".repeat(52)}\n`;
      t += `🔴 장기부동 ${s.counts.LONG_DOWNTIME} / 🔁 반복 ${s.counts.HIGH_FREQUENCY} / ⚙️ 조건변경 ${s.counts.CONDITION_CHANGE} / 🧪 테스트PM ${s.counts.TEST_PM} / 🟣 품질NG ${s.counts.QUALITY_NG}\n`;

      // 1. 일별
      if (s.dailyOverview.length > 0) {
        t += `\n[📊 일별 부동 현황]\n`;
        s.dailyOverview.forEach(d => { t += `  ${d.date}: ${d.count}건 / ${d.totalMin}분\n`; });
        t += `  합계: ${s.dailyOverview.reduce((a,b)=>a+b.count,0)}건 / ${s.dailyOverview.reduce((a,b)=>a+b.totalMin,0)}분\n`;
      }
      // 2. 장기부동
      if (s.longDowntime.length > 0) {
        t += `\n[🔴 장기부동 (${s.threshold}분 이상, ${s.longDowntime.length}건)]\n`;
        s.longDowntime.forEach(i => {
          t += `  ${i.date} ${i.time} | ${i.eq || "-"} | ${i.durMin}분 (점수${i.score}) | ${(i.prob || "").slice(0,80)}\n`;
        });
      }
      // 3. 반복 (3축)
      if (s.eqRanked.length > 0) {
        t += `\n[🔁 반복 — 설비별 TOP ${s.eqRanked.length}]\n`;
        s.eqRanked.forEach(e => { t += `  ${e.equipment}: ${e.count}회\n`; });
      }
      if (s.alarmRanked.length > 0) {
        t += `\n[🔁 반복 — 알람별 TOP ${s.alarmRanked.length}]\n`;
        s.alarmRanked.forEach(a => { t += `  ${a.count}회 | ${a.alarm.slice(0,90)}\n`; });
      }
      if (s.causeCategoryRanked.length > 0) {
        t += `\n[🔁 반복 — 원인 카테고리]\n`;
        s.causeCategoryRanked.forEach(c => { t += `  ${c.category}: ${c.count}회\n`; });
      }
      // 4. 조건변경
      if (s.conditionChanges.length > 0) {
        t += `\n[⚙️ 설비/공정 조건 변경 (${s.conditionChanges.length}건)]\n`;
        s.conditionChanges.forEach(c => { t += `  ${c.date} ${c.time} | ${c.item} | ${c.who || "-"}\n`; });
      }
      // 5. 테스트
      if (s.testPm.length > 0) {
        t += `\n[🧪 테스트 / PM (${s.testPm.length}건)]\n`;
        s.testPm.forEach(p => { t += `  ${p.date} ${p.time} | ${p.item} | ${p.purpose || "-"}\n`; });
      }
      // 6. 품질
      if (s.qualityNg.length > 0) {
        t += `\n[🟣 품질 / NG (${s.qualityNg.length}건)]\n`;
        s.qualityNg.forEach(q => { t += `  ${q.date} ${q.time} | ${q.item} | ${q.note || "-"}\n`; });
      }
      // 7. 미해결
      if (s.unresolved.length > 0) {
        t += `\n[🚨 미해결 / 모니터링 필요 (${s.unresolved.length}건)]\n`;
        s.unresolved.forEach(i => {
          t += `  ${i.date} ${i.time} | ${i.eq || "-"} | ${(i.prob || "").slice(0,80)} | ${(i.result || "-").slice(0,60)}\n`;
        });
      }
      // 8. 인사이트
      if (s.insights.length > 0) {
        t += `\n[💡 핵심 시사점]\n`;
        s.insights.forEach((ins, idx) => { t += `  ${idx+1}. ${ins}\n`; });
      }
      t += `\n${"═".repeat(52)}\n생성: ${new Date().toLocaleString("ko-KR")}\n`;
      // 간단모드는 여기서 종료
      const blob = new Blob([t], {type:"text/plain;charset=utf-8"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `회의록_${minutes.date.replace(/[\s/~]/g,"_").replace(/[()]/g,"")}_간단.txt`;
      a.click();
      return;
    }

    // ★ PE 사전 큐레이션
    if (minutes.curation) {
      t += `\n${"═".repeat(52)}\n📝 PE 사전 큐레이션\n${"═".repeat(52)}\n`;
      t += `\n${minutes.curation.summary_text}\n`;

      if (minutes.curation.daily_table?.length > 0) {
        t += `\n[일자별 주요 이슈]\n`;
        minutes.curation.daily_table.forEach(row => {
          t += `  ${row.date} | ${row.equipment} | ${row.issue} | ${row.action} | ${row.downtime}분\n`;
        });
      }

      if (minutes.curation.long_downtime?.length > 0) {
        t += `\n[장기 부동 (${minutes.curation.long_downtime.length}건)]\n`;
        minutes.curation.long_downtime.forEach(d => {
          t += `  • ${d.equipment}: ${d.reason} (${d.duration_note}, ${d.status})\n`;
        });
      }

      if (minutes.curation.recurring?.length > 0) {
        t += `\n[반복 발생 항목 (${minutes.curation.recurring.length}건)]\n`;
        minutes.curation.recurring.forEach(r => {
          t += `  • ${r.item} (${r.count}회) - ${r.lines?.join(", ")}\n`;
          if (r.cause) t += `    원인: ${r.cause}\n`;
        });
      }

      // ★ 영역 5-I: 큐레이션 이력 카테고리 3종
      if (minutes.curation.quality_issues?.length > 0) {
        t += `\n[품질 이슈 이력 (${minutes.curation.quality_issues.length}건)]\n`;
        minutes.curation.quality_issues.forEach(q => {
          t += `  • ${q.date} ${q.time} | ${q.item}`;
          if (q.note && q.note !== "-") t += ` (${q.note})`;
          t += `\n`;
        });
      }

      if (minutes.curation.process_changes?.length > 0) {
        t += `\n[공정/설비 조건변경 이력 (${minutes.curation.process_changes.length}건)]\n`;
        minutes.curation.process_changes.forEach(c => {
          t += `  • ${c.date} ${c.time} | ${c.item}`;
          if (c.who && c.who !== "-") t += ` (${c.who})`;
          t += `\n`;
        });
      }

      if (minutes.curation.tests_inspections?.length > 0) {
        t += `\n[테스트/양산외 생산 이력 (${minutes.curation.tests_inspections.length}건)]\n`;
        minutes.curation.tests_inspections.forEach(test => {
          t += `  • ${test.date} ${test.time} | ${test.item}`;
          if (test.purpose && test.purpose !== "-") t += ` (${test.purpose})`;
          t += `\n`;
        });
      }
    }

    // ★ 영역 5-I: 참고용 — 선정 기준 / 점수 공식 / 모드 정의
    t += `\n${"─".repeat(52)}\n[참고: 선정 기준 / 점수 공식 / 모드 정의]\n${"─".repeat(52)}\n`;
    t += `① 본문 논의 대상\n`;
    t += `   - 장기부동 (60분↑ OR Result에 "not solved")\n`;
    t += `   - 반복 (동일 호기/부품 2회↑)\n`;
    t += `   - Full Stop (라인 완전정지)\n`;
    t += `   → 점수 상위 ${MAX_ISSUES}건 선정 (공정변경·테스트·품질은 큐레이션 이력만)\n`;
    t += `② 점수 공식\n`;
    t += `   score = 부동(분)/30 + 반복횟수×3 + 안전환경(+10) + 미해결(+5) + FullStop(+5)\n`;
    t += `③ 논의 모드\n`;
    t += `   - DEEP    : 안전·환경·품질통제·출하고객·라인정지 키워드 OR 긴급 → 8필드 풀 논의\n`;
    t += `   - STANDARD: 중요 (반복/FullStop/부품반복) → 3필드 액션플랜\n`;
    t += `   - LITE    : 일반 (완료/단순) → 압축 평가\n`;

    // 시간/빈도 분석
    if (minutes.analytics) {
      t += `\n${"═".repeat(52)}\n📊 이슈 분석 요약\n${"═".repeat(52)}\n`;
      t += `\n⏰ 시간대별 발생 TOP 5\n`;
      minutes.analytics.timeOfDay.forEach((b, i) => {
        t += `  ${i+1}. ${b.label}  ${b.count}건\n`;
      });
      t += `\n🔁 발생 빈도 TOP 5 (설비 × 공정)\n`;
      minutes.analytics.categoryFreq.forEach((c, i) => {
        t += `  ${i+1}. ${c.key}  ${c.count}건\n`;
      });
    }

    // ★ 이슈별 상세 카드 (모드별 차등)
    if (minutes.detailCards?.length > 0) {
      t += `\n${"═".repeat(52)}\n📋 이슈별 상세 분석 카드\n${"═".repeat(52)}\n`;
      minutes.detailCards.forEach((card, i) => {
        t += `\n[${i+1}] ${card.header}${card.isPostAction ? " ✓ 기조치" : ""} [${card.mode}]\n`;
        t += `${"─".repeat(40)}\n`;
        t += `분류 사유: ${card.modeReason}\n`;
        if (card.fallbackLevel !== "primary") {
          t += `⚠️ 사회자 폴백: ${card.fallbackLevel}\n`;
        }
        t += `\n현상: ${card["현상"]}\n`;
        t += `원인: ${card["원인"]}\n`;

        if (card.mode === "DEEP") {
          t += `즉시 조치: ${card["즉시조치"]}\n`;
          t += `★ 기존 조치 적절성: ${card["기존조치_적절성"]}\n`;
          t += `재발 방지책: ${card["재발방지책"]}\n`;
          t += `보완책: ${card["보완책"]}\n`;
          t += `\n발언자별 의견:\n`;
          (card["발언자별의견"] || []).forEach(v => {
            t += `  ${v.icon} ${v.label} [${v.stance}]: ${v.summary}\n`;
          });
          t += `\n합의/반대 지점: ${card["합의반대지점"]}\n`;
        } else {
          t += `대책: ${card["대책"]}\n`;
        }
      });
    }

    // 모드별 건별 논의 결과 (페르소나 원본 의견)
    if (discussions.length > 0) {
      t += `\n${"═".repeat(52)}\n💬 건별 논의 원본 (페르소나 의견 + 사회자 종합)\n${"═".repeat(52)}\n`;
      for (const mode of ["DEEP", "STANDARD", "LITE"]) {
        const items = (minutes.grouped?.[mode]) || [];
        if (items.length === 0) continue;
        t += `\n${MODE_STYLE[mode].label} (${items.length}건)\n${"─".repeat(40)}\n`;
        items.forEach((d, i) => {
          t += `\n[${mode}-${i+1}] ${d.issue.eq} (${d.issue.durMin}분, ${d.issue.time})${d.isPostAction ? " ✓ 기조치" : ""}\n`;
          t += `  분류: ${d.modeInfo.reason} (${d.modeInfo.source})\n`;
          if (d.router) t += `  발언 순서: ${d.router.order.join(" → ")} (${d.router.reason})\n`;
          if (d.moderator?._fallback_level && d.moderator._fallback_level !== "primary") {
            t += `  ⚠️ 사회자 폴백: ${d.moderator._fallback_level}\n`;
          }

          // 페르소나 의견 (6필드, 대화체)
          if (d.opinions.length > 0) {
            t += `\n  ── 페르소나 의견 (대화체) ──\n`;
            d.opinions.forEach(o => {
              const p = PERSONAS[o.persona];
              const op = o.opinion || {};
              t += `\n  ${p.icon} ${p.label} (${o.persona}) [${op.stance || "-"}]\n`;
              if (op.previous_reference && op.previous_reference !== "") {
                t += `     💬 인용: "${op.previous_reference}"\n`;
              }
              t += `     📌 현상: ${op["현상"] || "-"}\n`;
              t += `     🔍 원인: ${op["원인"] || "-"}\n`;
              t += `     ⚡ 대책: ${op["대책"] || "-"}\n`;
              if (op["기존조치_평가"] && op["기존조치_평가"] !== "해당없음" && op["기존조치_평가"] !== "-") {
                t += `     🔁 기조치 평가: ${op["기존조치_평가"]}\n`;
              }
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

  // ─── ★ 영역 7: 자유 채팅방 백엔드 ─────────────────────────────────────────────
  // 7-E: STEP에 따라 가용 컨텍스트 빌드 (이슈 데이터 자동 적응)
  const buildChatContext = () => {
    const parts = [];
    parts.push(`현재 단계: STEP ${step}`);
    if (step === 0) {
      parts.push("아직 WhatsApp 파일이 업로드되지 않았습니다. 일반적인 공정 상담만 가능합니다.");
    } else if (step >= 1 && allMsgs.length > 0) {
      parts.push(`업로드된 메시지: ${allMsgs.length}건, 발생 일자 수: ${dates.length}일`);
      if (selRange && selRange.start && selRange.end) {
        parts.push(`분석 대상 기간: ${buildRangeLabel(selRange)}`);
      } else if (selDates.length > 0) {
        parts.push(`분석 대상 일자: ${selDates.join(", ")}`);
      }
    }
    if (priority && Array.isArray(priority)) {
      // 영역 11: priority는 평면 배열. tags로 분류 표시.
      const longCount = priority.filter(i => (i.tags || []).includes("LONG_DOWNTIME")).length;
      const freqCount = priority.filter(i => (i.tags || []).includes("HIGH_FREQUENCY")).length;
      parts.push(`이슈 분류: 전체 ${priority.length}건 | 장기부동 ${longCount}건 / 반복 ${freqCount}건`);
      const top = priority.filter(i =>
        (i.tags || []).includes("LONG_DOWNTIME") || (i.tags || []).includes("HIGH_FREQUENCY")
      ).slice(0, 15);
      if (top.length > 0) {
        parts.push("\n[주요 이슈 목록 (상위 15건, tag 보유)]");
        top.forEach((d, i) => {
          parts.push(`${i+1}. [${d.date} ${d.time}] ${d.eq || "-"} | ${d.durMin}분 | Problem: ${d.prob || "-"} | Cause: ${d.cause || "-"} | Result: ${d.result || "-"}`);
        });
      }
    }
    if (preCuration) {
      parts.push(`\n[PE 사전 큐레이션 요약]\n${preCuration.summary_text || ""}`);
      if (preCuration.long_downtime?.length > 0) {
        parts.push(`장기부동 ${preCuration.long_downtime.length}건, 반복 ${preCuration.recurring?.length || 0}건, 품질 ${preCuration.quality_issues?.length || 0}건, 공정변경 ${preCuration.process_changes?.length || 0}건, 테스트 ${preCuration.tests_inspections?.length || 0}건`);
      }
    }
    if (minutes && step === 4) {
      parts.push(`\n[STEP 4 보고서 완성됨 — ${minutes.detailCards?.length || 0}건 이슈 분석 완료]`);
    }
    return parts.join("\n");
  };

  // 7-D: @멘션 파싱 + 라우터 (멘션 우선, 없으면 Haiku로 자동 선택)
  const extractMentions = (text) => {
    // @PE, @EE, @FA, @Cell_PE, @Elec_EE 등 모두 지원
    // chatAgents 코드와 매칭되는 것만 채택
    const mentions = new Set();
    const tokens = (text.match(/@\w+/g) || []).map(t => t.slice(1));
    for (const tok of tokens) {
      // 정확 매칭 우선
      const exact = chatAgents.find(a => a === tok || a.toLowerCase() === tok.toLowerCase());
      if (exact) { mentions.add(exact); continue; }
      // 후위 매칭 (PE → Cell_PE 또는 Elec_PE 모두)
      const suffix = chatAgents.filter(a => a.endsWith(`_${tok}`) || a.endsWith(`_${tok.toUpperCase()}`));
      suffix.forEach(s => mentions.add(s));
    }
    return Array.from(mentions);
  };

  const routeChatQuestion = async (userText) => {
    if (chatAgents.length === 1) return [chatAgents[0]];
    const mentioned = extractMentions(userText);
    if (mentioned.length > 0) return mentioned;
    // 자동 라우터 (Haiku)
    const agentList = chatAgents.map(a => `${a} (${PERSONAS[a]?.role || ""})`).join("\n");
    const sys = `당신은 멀티 에이전트 채팅방의 라우터입니다. 사용자 질문을 보고 가장 적합한 에이전트 1~2명을 골라 코드를 JSON으로 반환하세요. 다른 텍스트 금지.`;
    const userMsg = `[참석 에이전트]
${agentList}

[사용자 질문]
${userText}

다음 형식으로 출력:
{"agents":["코드1","코드2"]}  // 1명만 적합하면 1개, 최대 2명까지`;
    try {
      const raw = await callClaudeRaw(sys, userMsg, { model: MODEL_FAST, max_tokens: 200 });
      const parsed = safeJSON(raw);
      const picked = (parsed.agents || []).filter(a => chatAgents.includes(a));
      if (picked.length > 0) return picked.slice(0, 2);
    } catch {/* 폴백 */}
    // 폴백: 첫 번째 에이전트 1명
    return [chatAgents[0]];
  };

  // 7-D: 단일 에이전트 응답 생성
  const generateAgentReply = async (agentCode, userText, history) => {
    const persona = PERSONAS[agentCode];
    if (!persona) return "(에이전트를 찾을 수 없음)";
    const kbText = chatKb[agentCode] ? `\n\n[학습 내용]\n${chatKb[agentCode].slice(0, 1500)}` : "";
    const ctx = buildChatContext();
    const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장의 ${persona.role}입니다.
이 채팅방은 사용자가 이슈와 관련해 자유롭게 질문하는 자리입니다.${kbText}

[현재 컨텍스트]
${ctx}

[규칙]
- 당신의 역할 관점에서 답하세요.
- 이슈 데이터가 없으면 일반 상담으로 답하되, 추가 데이터가 필요하면 그렇다고 안내하세요.
- 답변은 간결하게 (5문장 이내 권장, 필요하면 늘어남).
- 이미 답변한 다른 에이전트가 있으면 중복 피하고 보완하는 관점으로.`;
    const historyText = history.slice(-10).map(m => {
      if (m.role === "user") return `[사용자] ${m.text}`;
      return `[${PERSONAS[m.agent]?.label || m.agent}] ${m.text}`;
    }).join("\n");
    const userMsg = `[직전까지의 대화]
${historyText || "(이번이 첫 질문)"}

[현재 사용자 질문]
${userText}

당신의 답변:`;
    try {
      const raw = await callClaudeRaw(sys, userMsg, { model: MODEL_REASONING, max_tokens: 800 });
      return raw.trim();
    } catch (e) {
      return `(응답 실패: ${e?.message || e})`;
    }
  };

  // 7-D: 채팅 메시지 전송
  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    const userMsg = { role: "user", text, time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) };
    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setChatInput("");
    setChatBusy(true);
    try {
      const responders = await routeChatQuestion(text);
      let runningHistory = newHistory;
      for (const code of responders) {
        const reply = await generateAgentReply(code, text, runningHistory);
        const replyMsg = {
          role: "assistant", agent: code, text: reply,
          time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
        };
        runningHistory = [...runningHistory, replyMsg];
        setChatMessages(runningHistory);
      }
    } catch (e) {
      setChatMessages(prev => [...prev, {
        role: "assistant", agent: "system",
        text: `(시스템 오류: ${e?.message || e})`,
        time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
      }]);
    } finally {
      setChatBusy(false);
    }
  };

  // 7-D: 채팅방 개설 (에이전트 선택 후 KB 로드)
  const openChatRoom = async () => {
    if (chatAgents.length === 0) return;
    setChatBusy(true);
    try {
      const kbResult = await loadSelectedKnowledge(chatAgents);
      setChatKb(kbResult.kb || {});
    } catch {
      setChatKb({});  // KB 로드 실패해도 진행
    }
    setChatStage("active");
    setChatBusy(false);
  };

  // 7-F: 대화 내용 TXT 다운로드
  const downloadChatTxt = () => {
    if (chatMessages.length === 0) return;
    const stamp = new Date().toLocaleString("ko-KR");
    let t = `AZS 자유 채팅방 대화 기록\n생성: ${stamp}\n참석 에이전트: ${chatAgents.map(a => `${a}(${PERSONAS[a]?.label || a})`).join(", ")}\n${"═".repeat(52)}\n\n`;
    chatMessages.forEach(m => {
      if (m.role === "user") {
        t += `[${m.time}] 사용자\n  ${m.text}\n\n`;
      } else {
        const label = PERSONAS[m.agent]?.label || m.agent;
        t += `[${m.time}] ${label}\n  ${m.text.replace(/\n/g, "\n  ")}\n\n`;
      }
    });
    const blob = new Blob([t], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), {
      href: url, download: `chat_${new Date().toISOString().slice(0,10)}.txt`,
    }).click();
    URL.revokeObjectURL(url);
  };

  // 7-D: 채팅방 닫기 (대화 초기화)
  const closeChatRoom = () => {
    if (chatMessages.length > 0 && !window.confirm("대화가 사라집니다. TXT 저장 안 하셨다면 먼저 저장하세요. 그래도 닫을까요?")) return;
    setChatOpen(false);
    setChatStage("setup");
    setChatAgents([]);
    setChatMessages([]);
    setChatInput("");
    setChatKb({});
  };

  const reset = () => {
    setStep(0); setAllMsgs([]); setDates([]); setSelDates([]);
    setSelRange({ start: null, end: null, unit: "day" });
    setClassified(null); setPriority(null); setKbStats(null);
    setDiscussions([]); setMinutes(null); setProgress([]);
    setError(""); setSheetSaved(false); setReportType("meeting");
    setTaggedIssues(null);
    setSelectedProcess("Cell"); setExtraAgents([]);
    // ★ 영역 6: 큐레이션 캐시 + 선택 상태 초기화
    setPreCuration(null); setPreCategoryMsgs(null);
    setAutoSelectedIds([]); setSelectedIssueIds([]);
    setCurating(false);
    // ★ 영역 7: 채팅방 상태 초기화
    setChatOpen(false); setChatStage("setup"); setChatAgents([]);
    setChatMessages([]); setChatInput(""); setChatKb({}); setChatBusy(false);
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
          <div style={{fontSize:13,fontWeight:800,color:"#f1f5f9"}}>AZS · 논의 시스템 v3.1 · PE 큐레이션 + 대화형 논의</div>
          <div style={{fontSize:9,color:"#22d3ee",letterSpacing:2,fontWeight:700}}>Cell · Elec · FA · Vision  |  AZS</div>
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
              🆕 v3.1: PE 사전 큐레이션 + 대화체 논의 + 사회자 3단계 폴백 + 이슈 상세 카드 + 기조치 평가
            </div>
          </div>
        )}

        {/* STEP 1: 날짜 선택 */}
        {step===1 && (
          <div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>날짜 범위 선택</div>
              <div style={{fontSize:12,color:"#475569"}}>
                총 {dates.length}일치 데이터 · 시작/끝 날짜 선택 (또는 빠른 선택 / 단위 변경)
              </div>
            </div>

            <DateRangePicker
              availableDates={dates}
              selRange={selRange}
              onChange={(r)=>{
                setSelRange({ start: r.start, end: r.end, unit: r.unit });
                setSelDates(r.dates || []);
              }}
            />

            <div style={{display:"flex",gap:10, marginTop:12}}>
              <BackBtn onClick={()=>setStep(0)} label="← 파일 재선택"/>
              <button onClick={handleDateConfirm} disabled={selDates.length===0} style={{
                flex:1, padding:"12px",
                background:selDates.length>0?"linear-gradient(135deg,#3b82f6,#22d3ee)":"rgba(51,65,85,0.3)",
                border:"none", borderRadius:8,
                color:selDates.length>0?"#fff":"#374151",
                fontSize:13, fontWeight:800,
                cursor:selDates.length>0?"pointer":"not-allowed",
              }}>{selDates.length > 0 ? `보고서 종류 선택 (${selDates.length}일) →` : "기간을 선택하세요"}</button>
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

            {/* 영역 11: 모드 토글 폐기 (간단/상세 모드 폐기) */}

            <div style={{display:"flex",gap:10}}>
              <BackBtn onClick={()=>setStep(1)} label="← 날짜 선택"/>
              <button onClick={handleReportConfirm} style={{
                flex:1, padding:"12px",
                background:"linear-gradient(135deg,#a78bfa,#7c3aed)",
                border:"none", borderRadius:8, color:"#fff",
                fontSize:13, fontWeight:800, cursor:"pointer",
              }}>이슈 브리핑 시작 →</button>
            </div>
          </div>
        )}

        {/* STEP 3: 이슈 확인 */}
        {step===3 && classified && priority && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>
                AZS Factory 이슈 브리핑
              </div>
              <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.6}}>
                <strong style={{color:"#cbd5e1"}}>분석 기간:</strong> {buildProductionRangeLabel(selDates)}
              </div>
            </div>

            {/* ★ 공정 선택 */}
            <div style={{
              background:"rgba(34,211,238,0.06)",
              border:"1px solid rgba(34,211,238,0.2)",
              borderRadius:10, padding:"14px 16px", marginBottom:12,
            }}>
              <div style={{fontSize:11,color:"#22d3ee",fontWeight:800,marginBottom:10}}>
                🏭 분석 대상 공정 선택
              </div>
              <div style={{display:"flex",gap:10}}>
                {Object.entries(PROCESSES).map(([key, proc]) => (
                  <button key={key} onClick={()=>{
                    setSelectedProcess(key);
                    // 공정 변경 시 같은 공정의 추가 선택은 자동 제거
                    setExtraAgents(prev => prev.filter(a => !PROCESSES[key].auto.includes(a)));
                  }} style={{
                    flex:1, padding:"10px 14px",
                    background: selectedProcess===key ? "rgba(34,211,238,0.2)" : "rgba(15,23,42,0.6)",
                    border:`1.5px solid ${selectedProcess===key ? "#22d3ee" : "rgba(51,65,85,0.5)"}`,
                    borderRadius:8,
                    color: selectedProcess===key ? "#22d3ee" : "#94a3b8",
                    fontSize:12, fontWeight:700, cursor:"pointer",
                    textAlign:"left",
                  }}>
                    <div>{proc.icon} {proc.label}</div>
                    <div style={{fontSize:9,opacity:0.8,marginTop:3}}>
                      자동 참여: {proc.auto.map(a => a.replace(`${key}_`,"")).join(" / ")}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ★ 자동 참여 표시 (변경 불가) */}
            <div style={{
              background:"rgba(15,23,42,0.5)",
              border:"1px solid rgba(51,65,85,0.4)",
              borderRadius:10, padding:"12px 14px", marginBottom:12,
            }}>
              <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,marginBottom:8}}>
                ✅ 자동 참여 (변경 불가)
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {PROCESSES[selectedProcess].auto.map(code => {
                  const p = PERSONAS[code];
                  return (
                    <span key={code} style={{
                      fontSize:11, padding:"4px 10px",
                      background:p.bg, color:p.color, fontWeight:700,
                      border:`1px solid ${p.color}`, borderRadius:14,
                    }}>{p.icon} {p.label}</span>
                  );
                })}
              </div>
            </div>

            {/* ★ 추가 참여 에이전트 선택 (그룹 분류) */}
            <div style={{
              background:"rgba(167,139,250,0.05)",
              border:"1px solid rgba(167,139,250,0.2)",
              borderRadius:10, padding:"12px 14px", marginBottom:14,
            }}>
              <div style={{fontSize:10,color:"#a78bfa",fontWeight:700,marginBottom:10}}>
                ➕ 추가 참여 에이전트 선택 (선택사항)
                {extraAgents.length > 0 && (
                  <span style={{marginLeft:8,color:"#cbd5e1"}}>
                    {extraAgents.length}명 추가됨
                  </span>
                )}
              </div>

              {/* 다른 공정 자문 */}
              <div style={{marginBottom:10}}>
                <div style={{fontSize:9,color:"#64748b",fontWeight:700,marginBottom:6}}>
                  ── 다른 공정 자문 ({PROCESSES[PROCESSES[selectedProcess].otherProcess].label})
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {PROCESSES[PROCESSES[selectedProcess].otherProcess].auto.map(code => {
                    const p = PERSONAS[code];
                    const checked = extraAgents.includes(code);
                    return (
                      <label key={code} style={{
                        fontSize:11, padding:"4px 10px",
                        background: checked ? p.bg : "rgba(15,23,42,0.4)",
                        color: checked ? p.color : "#64748b",
                        border:`1px solid ${checked ? p.color : "rgba(51,65,85,0.5)"}`,
                        borderRadius:14, cursor:"pointer", fontWeight: checked ? 700 : 400,
                        display:"flex", alignItems:"center", gap:5,
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setExtraAgents(prev =>
                              checked ? prev.filter(a => a !== code) : [...prev, code]
                            );
                          }}
                          style={{margin:0, cursor:"pointer"}}
                        />
                        {p.icon} {p.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* 공통 에이전트 */}
              <div>
                <div style={{fontSize:9,color:"#64748b",fontWeight:700,marginBottom:6}}>
                  ── 공통 에이전트
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {COMMON_AGENTS.map(code => {
                    const p = PERSONAS[code];
                    const checked = extraAgents.includes(code);
                    return (
                      <label key={code} style={{
                        fontSize:11, padding:"4px 10px",
                        background: checked ? p.bg : "rgba(15,23,42,0.4)",
                        color: checked ? p.color : "#64748b",
                        border:`1px solid ${checked ? p.color : "rgba(51,65,85,0.5)"}`,
                        borderRadius:14, cursor:"pointer", fontWeight: checked ? 700 : 400,
                        display:"flex", alignItems:"center", gap:5,
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setExtraAgents(prev =>
                              checked ? prev.filter(a => a !== code) : [...prev, code]
                            );
                          }}
                          style={{margin:0, cursor:"pointer"}}
                        />
                        {p.icon} {p.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{fontSize:9,color:"#475569",marginTop:8,lineHeight:1.5}}>
                💡 추가한 에이전트는 모든 DEEP/STANDARD 이슈에 참여합니다. (LITE는 사회자 단독)
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
                {Object.entries(kbStats).filter(([k]) => PERSONAS[k]).map(([k, count]) => {
                  const p = PERSONAS[k];
                  return (
                    <span key={k} style={{color:p.color}}>{p.icon}{k}:{count}건</span>
                  );
                })}
              </div>
            )}

            <div style={{display:"flex",gap:8,marginBottom:14, flexWrap:"wrap"}}>
              {[
                {label:"🔴 장기부동",count:taggedIssues?.counts?.LONG_DOWNTIME || 0,color:"#ef4444",bg:"rgba(239,68,68,0.08)",border:"rgba(239,68,68,0.25)"},
                {label:"🔁 반복",count:taggedIssues?.counts?.HIGH_FREQUENCY || 0,color:"#f59e0b",bg:"rgba(245,158,11,0.08)",border:"rgba(245,158,11,0.25)"},
                {label:"⚙️ 조건변경",count:taggedIssues?.counts?.CONDITION_CHANGE || 0,color:"#34d399",bg:"rgba(52,211,153,0.08)",border:"rgba(52,211,153,0.25)"},
                {label:"🧪 테스트/PM",count:taggedIssues?.counts?.TEST_PM || 0,color:"#22d3ee",bg:"rgba(34,211,238,0.08)",border:"rgba(34,211,238,0.25)"},
                {label:"🟣 품질NG",count:taggedIssues?.counts?.QUALITY_NG || 0,color:"#a78bfa",bg:"rgba(167,139,250,0.08)",border:"rgba(167,139,250,0.25)"},
              ].map(p => (
                <div key={p.label} style={{
                  flex:1, minWidth:90, background:p.bg, border:`1px solid ${p.border}`,
                  borderRadius:8, padding:"10px", textAlign:"center",
                }}>
                  <div style={{fontSize:20,fontWeight:800,color:p.color}}>{p.count}</div>
                  <div style={{fontSize:10,color:p.color,fontWeight:700}}>{p.label}</div>
                </div>
              ))}
            </div>

            {/* ★ 영역 5-G: 큐레이션 이력 카테고리 카운트 (참고 표시) */}
            {classified && (classified.qualityMsgs?.length || classified.processChangeMsgs?.length || classified.testMsgs?.length || classified.ambiguousMsgs?.length) > 0 && (
              <div style={{
                background:"rgba(15,23,42,0.5)", border:"1px solid rgba(100,116,139,0.25)",
                borderRadius:10, padding:"10px 12px", marginBottom:12,
              }}>
                <div style={{fontSize:10,color:"#94a3b8",fontWeight:800,marginBottom:8}}>
                  📦 큐레이션 이력 카테고리 (본문 논의 외 — 보고서 상단에 정리됨)
                </div>
                <div style={{display:"flex",gap:8}}>
                  {[
                    {label:"🧪 품질",count:classified.qualityMsgs?.length || 0,color:"#a78bfa",bg:"rgba(167,139,250,0.08)",border:"rgba(167,139,250,0.2)"},
                    {label:"⚙️ 공정변경",count:classified.processChangeMsgs?.length || 0,color:"#34d399",bg:"rgba(52,211,153,0.08)",border:"rgba(52,211,153,0.2)"},
                    {label:"🔬 테스트",count:classified.testMsgs?.length || 0,color:"#22d3ee",bg:"rgba(34,211,238,0.08)",border:"rgba(34,211,238,0.2)"},
                    {label:"🔀 모호",count:classified.ambiguousMsgs?.length || 0,color:"#94a3b8",bg:"rgba(100,116,139,0.08)",border:"rgba(100,116,139,0.2)"},
                  ].map(c => (
                    <div key={c.label} style={{
                      flex:1, background:c.bg, border:`1px solid ${c.border}`,
                      borderRadius:6, padding:"6px 8px", textAlign:"center",
                    }}>
                      <div style={{fontSize:14,fontWeight:800,color:c.color}}>{c.count}</div>
                      <div style={{fontSize:9,color:c.color,fontWeight:700}}>{c.label}</div>
                    </div>
                  ))}
                </div>
                {(classified.ambiguousMsgs?.length || 0) > 0 && (
                  <div style={{fontSize:9,color:"#64748b",marginTop:6}}>
                    ※ 모호 {classified.ambiguousMsgs.length}건은 분석 시작 시 AI(Haiku)가 카테고리 판정
                  </div>
                )}
              </div>
            )}

            <div style={{
              background:"rgba(167,139,250,0.06)", border:"1px solid rgba(167,139,250,0.2)",
              borderRadius:10, padding:"12px 14px", marginBottom:12,
            }}>
              <div style={{fontSize:10,color:"#a78bfa",fontWeight:800,marginBottom:8}}>
                🔍 차등 논의 모드 안내 · 참여 {PROCESSES[selectedProcess].auto.length + extraAgents.length}명
              </div>
              <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.7}}>
                🔴 DEEP: 사용자 추가 또는 LONG_DOWNTIME tag → 5섹션 풀 논의<br/>
                🟡 STANDARD: HIGH_FREQUENCY tag만 → 액션 플랜<br/>
                🟢 LITE: 자동 분류 → 압축 평가<br/>
                <span style={{color:"#a78bfa",fontWeight:800}}>
                  체크박스로 선택한 이슈만 본문 논의 대상
                </span>
              </div>
              <div style={{fontSize:9,color:"#475569",marginTop:6}}>
                ※ 안전·환경·SAR/NCR/HOLD 키워드 감지 시 자동 DEEP 강제
              </div>
            </div>

            {/* ★ 영역 6-C: 큐레이션 로딩 표시 (사전 실행 중일 때만) */}
            {curating && (
              <div style={{
                background:"rgba(59,130,246,0.05)", border:"1px solid rgba(59,130,246,0.25)",
                borderRadius:10, padding:"14px 16px", marginBottom:12,
                display:"flex", alignItems:"center", gap:10,
              }}>
                <Spinner/>
                <div style={{fontSize:11,color:"#93c5fd"}}>
                  PE 사전 큐레이션 실행 중... (전체 이슈 정리, 약 30초 소요)
                </div>
              </div>
            )}

            {/* ★ 영역 11-K: 이슈 브리핑 (HTML 1~5번) — 인라인 체크박스 통합 */}
            {!curating && preCuration && taggedIssues && (
              <div style={{marginBottom:14}}>
                <div style={{
                  display:"flex", alignItems:"center", justifyContent:"space-between",
                  marginBottom:10, padding:"4px 0",
                }}>
                  <div style={{fontSize:12,fontWeight:800,color:"#22d3ee"}}>
                    📋 이슈 브리핑 — 본문에서 직접 체크하여 논의 대상 선정
                  </div>
                  <div style={{fontSize:10,color:"#22d3ee",fontWeight:700}}>
                    선택 {selectedIssueIds.length}건 / 자동 {autoSelectedIds.length}건 / 전체 {(taggedIssues.issues || []).length}건
                  </div>
                </div>

                {/* 일괄 액션 버튼 */}
                <div style={{display:"flex",gap:6,marginBottom:10, flexWrap:"wrap"}}>
                  <button onClick={()=>setSelectedIssueIds((taggedIssues.issues || []).map(getIssueId))} style={{
                    fontSize:9, padding:"3px 8px", borderRadius:4,
                    background:"rgba(34,211,238,0.1)", border:"1px solid rgba(34,211,238,0.3)",
                    color:"#22d3ee", cursor:"pointer", fontWeight:700,
                  }}>전체 선택</button>
                  <button onClick={()=>setSelectedIssueIds([])} style={{
                    fontSize:9, padding:"3px 8px", borderRadius:4,
                    background:"rgba(100,116,139,0.1)", border:"1px solid rgba(100,116,139,0.3)",
                    color:"#94a3b8", cursor:"pointer", fontWeight:700,
                  }}>전체 해제</button>
                  <button onClick={()=>setSelectedIssueIds([...autoSelectedIds])} style={{
                    fontSize:9, padding:"3px 8px", borderRadius:4,
                    background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.3)",
                    color:"#f59e0b", cursor:"pointer", fontWeight:700,
                  }}>자동 선정만 (⭐)</button>
                </div>

                <BriefingDisplay
                  curation={preCuration}
                  allIssues={taggedIssues.issues || []}
                  selectedIds={selectedIssueIds}
                  autoSelectedIds={autoSelectedIds}
                  onToggle={toggleIssueSelection}
                  onToggleMany={(ids, shouldCheck) => {
                    setSelectedIssueIds(prev => {
                      if (shouldCheck) {
                        const next = new Set(prev);
                        ids.forEach(id => next.add(id));
                        return Array.from(next);
                      } else {
                        return prev.filter(id => !ids.includes(id));
                      }
                    });
                  }}
                />
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
              <button onClick={runAnalysis} disabled={running || curating || selectedIssueIds.length === 0} style={{
                flex:1, padding:"12px",
                background:(running||curating||selectedIssueIds.length===0)?"rgba(51,65,85,0.3)":"linear-gradient(135deg,#3b82f6,#22d3ee)",
                border:"none", borderRadius:8,
                color:(running||curating||selectedIssueIds.length===0)?"#374151":"#fff",
                fontSize:13, fontWeight:800,
                cursor:(running||curating||selectedIssueIds.length===0)?"not-allowed":"pointer",
                display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              }}>
                {running ? <><Spinner/>분석 진행 중...</>
                  : curating ? <><Spinner/>큐레이션 준비 중...</>
                  : selectedIssueIds.length === 0 ? "⚠️ 논의할 이슈 1건 이상 선택하세요"
                  : `🔍 차등 논의 및 보고서 생성 (${selectedIssueIds.length}건) →`}
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

            {/* ★ 공정 / 참여 에이전트 정보 */}
            {minutes.process && minutes.allowedAgents && (
              <div style={{
                background:"rgba(34,211,238,0.06)",
                border:"1px solid rgba(34,211,238,0.2)",
                borderRadius:10, padding:"10px 14px", marginBottom:14,
                display:"flex", gap:12, alignItems:"center", flexWrap:"wrap",
              }}>
                <span style={{fontSize:11,fontWeight:800,color:"#22d3ee"}}>
                  {PROCESSES[minutes.process]?.icon} {PROCESSES[minutes.process]?.label}
                </span>
                <span style={{fontSize:10,color:"#94a3b8"}}>참여 {minutes.allowedAgents.length}명:</span>
                <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                  {minutes.allowedAgents.map(code => {
                    const p = PERSONAS[code];
                    return (
                      <span key={code} style={{
                        fontSize:10, padding:"2px 8px",
                        background:p.bg, color:p.color, fontWeight:700,
                        borderRadius:10,
                      }}>{p.icon} {code}</span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ★ 영역 5: 선정 기준 / 모드 정의 / 점수 공식 (드롭다운 — 평소 숨김) */}
            <div style={{marginBottom:14}}>
              <button onClick={()=>setShowCriteriaBox(v=>!v)} style={{
                width:"100%",
                background:"rgba(15,23,42,0.5)",
                border:"1px solid rgba(100,116,139,0.3)",
                borderRadius:8, padding:"8px 12px",
                color:"#94a3b8", fontSize:11, fontWeight:700,
                cursor:"pointer", textAlign:"left",
                display:"flex", alignItems:"center", justifyContent:"space-between",
              }}>
                <span>📋 본문 논의 선정 기준 / 논의 모드 정의 / 점수 공식 (참고용)</span>
                <span style={{fontSize:10,color:"#64748b"}}>{showCriteriaBox ? "▲ 접기" : "▼ 펼치기"}</span>
              </button>
              {showCriteriaBox && (
                <div style={{
                  marginTop:6,
                  background:"rgba(15,23,42,0.6)",
                  border:"1px solid rgba(100,116,139,0.25)",
                  borderRadius:8, padding:"12px 14px",
                  fontSize:10.5, color:"#cbd5e1", lineHeight:1.7,
                }}>
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:11,fontWeight:800,color:"#22d3ee",marginBottom:4}}>① 본문 논의 대상 선정 기준</div>
                    <div style={{paddingLeft:8,color:"#94a3b8"}}>
                      • <b style={{color:"#cbd5e1"}}>장기부동</b>: 부동시간 60분 이상 OR Result에 "not solved" 포함<br/>
                      • <b style={{color:"#cbd5e1"}}>반복</b>: 동일 호기 2회 이상 OR 동일 부품 2회 이상<br/>
                      • <b style={{color:"#cbd5e1"}}>Full Stop</b>: 라인 완전정지 이슈<br/>
                      → 위 3가지 후보 중 점수 상위 <b style={{color:"#cbd5e1"}}>{MAX_ISSUES}건</b> 선정<br/>
                      <span style={{color:"#64748b"}}>※ 공정/설비 조건변경 · Test/양산외 생산 · 품질이슈는 본문 논의 대신 큐레이션 이력으로만 정리</span>
                    </div>
                  </div>
                  <div style={{marginBottom:10}}>
                    <div style={{fontSize:11,fontWeight:800,color:"#22d3ee",marginBottom:4}}>② 점수 공식</div>
                    <div style={{paddingLeft:8,color:"#94a3b8",fontFamily:"monospace",background:"rgba(0,0,0,0.2)",padding:"6px 8px",borderRadius:4}}>
                      score = 부동(분)/30 + 반복횟수×3 + 안전환경(+10) + 미해결(+5) + FullStop(+5)<br/>
                      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; + 장기부동≥60분(+8) + 장기부동≥120분(+5)
                    </div>
                    <div style={{paddingLeft:8,color:"#64748b",marginTop:4,fontSize:10}}>
                      예: 부동 90분 + 반복 2회 + 안전키워드 → 3 + 6 + 10 = 19점
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:800,color:"#22d3ee",marginBottom:4}}>③ 논의 모드 정의 (DEEP / STANDARD / LITE)</div>
                    <div style={{paddingLeft:8,color:"#94a3b8"}}>
                      • <b style={{color:"#ef4444"}}>DEEP</b>: 안전·환경·품질통제·출하고객·라인정지 키워드 감지 OR 긴급 이슈<br/>
                      &nbsp;&nbsp;&nbsp;→ 8필드 상세 카드 + 다중 페르소나 논의<br/>
                      • <b style={{color:"#f59e0b"}}>STANDARD</b>: 중요 이슈 (반복 / Full Stop / 부품 반복교체)<br/>
                      &nbsp;&nbsp;&nbsp;→ 3필드 카드 + 페르소나 논의<br/>
                      • <b style={{color:"#94a3b8"}}>LITE</b>: 일반 이슈 (완료/단순)<br/>
                      &nbsp;&nbsp;&nbsp;→ 압축 평가 (간단 코멘트)
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ★ 영역 9-E: 간단 모드 — SimpleReport 컴포넌트 (페르소나 논의/큐레이션 박스/기존 보고서 모두 대체) */}
            {/* 영역 11: 단일 흐름 — SimpleReport 비활성 */}

            {/* ★ 영역 11-F: STEP 4 메인 페이지 (사용자 레포트 1~7번 형태) */}
            <MainReportPage minutes={minutes}/>

            {/* ★ 영역 11-G: 유첨 (Appendix) — 페르소나 논의 카드 (page-break-before: always) */}
            <div className="appendix-page-break" style={{
              marginTop:30, paddingTop:20,
              borderTop:"3px double rgba(100,116,139,0.5)",
            }}>
              <div style={{
                fontSize:14, fontWeight:900, color:"#a78bfa",
                padding:"10px 14px", background:"rgba(167,139,250,0.08)",
                border:"1px solid rgba(167,139,250,0.25)", borderRadius:8,
                marginBottom:14,
              }}>
                📎 전체 페르소나 논의 모아보기
              </div>
              <div style={{fontSize:10,color:"#94a3b8",marginBottom:12,fontStyle:"italic"}}>
                각 이슈별 페르소나 논의는 메인 페이지의 1~5번 섹션에 직접 매칭되어 표시됩니다.<br/>
                아래는 전체 페르소나 논의를 한 곳에서 통합 조회하는 영역입니다.
              </div>
            </div>

            {/* 모드별 분석 결과 — 상세 모드만 표시 */}
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

            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <button onClick={downloadHtml} style={{
                flex:1, padding:"11px",
                background:"linear-gradient(135deg,#3b82f6,#22d3ee)",
                border:"none", borderRadius:8, color:"#fff",
                fontSize:13, fontWeight:800, cursor:"pointer",
              }}>📥 HTML 다운로드</button>
              <button onClick={sendToTeams} disabled={teamsSending} style={{
                flex:1, padding:"11px",
                background: teamsSending ? "rgba(100,116,139,0.4)" : "linear-gradient(135deg,#8b5cf6,#ec4899)",
                border:"none", borderRadius:8, color:"#fff",
                fontSize:13, fontWeight:800, cursor: teamsSending ? "wait" : "pointer",
                opacity: teamsSending ? 0.7 : 1,
              }}>{teamsSending ? "⏳ 발송 중..." : "📤 Teams 발송"}</button>
              <button onClick={()=>{setStep(3);setMinutes(null);setDiscussions([]);setProgress([]);}} style={{
                flex:1, padding:"11px", background:"transparent",
                border:"1.5px solid rgba(167,139,250,0.35)", borderRadius:8,
                color:"#a78bfa", fontSize:13, fontWeight:800, cursor:"pointer",
              }}>🔄 다시 분석</button>
            </div>
            {/* 12-AK-5: Teams 발송 결과 토스트 */}
            {teamsResult && (
              <div style={{
                marginBottom: 10, padding: "9px 14px", borderRadius: 8,
                background: teamsResult.ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                border: `1px solid ${teamsResult.ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
                color: teamsResult.ok ? "#86efac" : "#fca5a5",
                fontSize: 12, fontWeight: 600, animation: "fadeUp 0.3s",
              }}>{teamsResult.msg}</div>
            )}
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
      {/* ★ 영역 7-B: 플로팅 채팅 버튼 (모든 STEP 공통) */}
      {!chatOpen && (
        <button onClick={()=>setChatOpen(true)} style={{
          position:"fixed", right:24, bottom:24, zIndex:9999,
          width:60, height:60, borderRadius:"50%",
          background:"linear-gradient(135deg,#3b82f6,#22d3ee)",
          border:"2px solid rgba(255,255,255,0.2)", cursor:"pointer",
          boxShadow:"0 8px 24px rgba(34,211,238,0.5), 0 0 0 4px rgba(34,211,238,0.15)",
          fontSize:26, color:"#fff",
          display:"flex", alignItems:"center", justifyContent:"center",
        }} title="자유 채팅방 열기">💬</button>
      )}

      {/* ★ 영역 7-C: 채팅창 모달 */}
      {chatOpen && (
        <div style={{
          position:"fixed", right:24, bottom:24, zIndex:9999,
          width:"min(440px, calc(100vw - 48px))",
          height:"min(640px, calc(100vh - 48px))",
          background:"rgba(3,6,13,0.97)",
          border:"1px solid rgba(34,211,238,0.3)",
          borderRadius:14,
          boxShadow:"0 10px 40px rgba(0,0,0,0.6)",
          display:"flex", flexDirection:"column",
          overflow:"hidden",
        }}>
          {/* 헤더 */}
          <div style={{
            padding:"12px 16px",
            borderBottom:"1px solid rgba(51,65,85,0.4)",
            display:"flex", alignItems:"center", justifyContent:"space-between",
            background:"rgba(15,23,42,0.6)",
          }}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14}}>💬</span>
              <div style={{fontSize:12,fontWeight:800,color:"#22d3ee"}}>
                {chatStage === "setup" ? "채팅방 개설" : `자유 채팅방 (${chatAgents.length}명)`}
              </div>
            </div>
            <div style={{display:"flex",gap:6}}>
              {chatStage === "active" && chatMessages.length > 0 && (
                <button onClick={downloadChatTxt} style={{
                  fontSize:10, padding:"4px 10px", borderRadius:5,
                  background:"rgba(52,211,153,0.1)", border:"1px solid rgba(52,211,153,0.3)",
                  color:"#34d399", cursor:"pointer", fontWeight:700,
                }} title="대화 내용 TXT 저장">💾 저장</button>
              )}
              <button onClick={closeChatRoom} style={{
                fontSize:14, padding:"2px 10px", borderRadius:5,
                background:"transparent", border:"1px solid rgba(100,116,139,0.4)",
                color:"#94a3b8", cursor:"pointer",
              }} title="채팅방 닫기">✕</button>
            </div>
          </div>

          {/* 본문 */}
          {chatStage === "setup" ? (
            // 에이전트 선택 화면
            <div style={{flex:1, padding:16, overflowY:"auto"}}>
              <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.6,marginBottom:12}}>
                대화에 참여할 에이전트를 선택하세요. (최소 1명)
                <div style={{fontSize:10,color:"#64748b",marginTop:4}}>
                  선택 후 KB가 로드되면 채팅이 시작됩니다.<br/>
                  여러 명을 선택하면 질문에 따라 자동으로 답할 사람을 정하거나 <code style={{color:"#22d3ee"}}>@PE</code> 식으로 직접 지정할 수 있습니다.
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2, 1fr)",gap:6,marginBottom:14}}>
                {Object.entries(PERSONAS).map(([code, p]) => {
                  const sel = chatAgents.includes(code);
                  return (
                    <button key={code} onClick={()=>setChatAgents(prev =>
                      prev.includes(code) ? prev.filter(x => x !== code) : [...prev, code]
                    )} style={{
                      padding:"8px 10px", borderRadius:6,
                      background: sel ? p.bg : "rgba(15,23,42,0.5)",
                      border:`1px solid ${sel ? p.color : "rgba(51,65,85,0.4)"}`,
                      color: sel ? p.color : "#94a3b8",
                      fontSize:10, fontWeight:700, cursor:"pointer", textAlign:"left",
                    }}>
                      <div>{p.icon} {p.label}</div>
                      <div style={{fontSize:8.5,opacity:0.75,marginTop:2}}>{code}</div>
                    </button>
                  );
                })}
              </div>
              <button onClick={openChatRoom}
                disabled={chatAgents.length === 0 || chatBusy} style={{
                  width:"100%", padding:"10px",
                  background: (chatAgents.length === 0 || chatBusy) ? "rgba(51,65,85,0.3)" : "linear-gradient(135deg,#3b82f6,#22d3ee)",
                  border:"none", borderRadius:8,
                  color: (chatAgents.length === 0 || chatBusy) ? "#475569" : "#fff",
                  fontSize:12, fontWeight:800,
                  cursor: (chatAgents.length === 0 || chatBusy) ? "not-allowed" : "pointer",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                }}>
                {chatBusy ? <><Spinner/>KB 로드 중...</> : `🚪 채팅방 개설 (${chatAgents.length}명)`}
              </button>
            </div>
          ) : (
            // 대화 화면
            <>
              {/* 참석자 표시 */}
              <div style={{
                padding:"6px 12px",
                background:"rgba(15,23,42,0.4)",
                borderBottom:"1px solid rgba(51,65,85,0.3)",
                display:"flex", gap:4, flexWrap:"wrap", fontSize:9,
              }}>
                {chatAgents.map(code => {
                  const p = PERSONAS[code];
                  return (
                    <span key={code} style={{
                      padding:"2px 7px", borderRadius:9,
                      background:p.bg, color:p.color, fontWeight:700,
                    }}>{p.icon} {code}</span>
                  );
                })}
              </div>

              {/* 메시지 영역 */}
              <div style={{flex:1, overflowY:"auto", padding:"12px 14px", background:"rgba(0,0,0,0.2)"}}>
                {chatMessages.length === 0 ? (
                  <div style={{fontSize:11,color:"#64748b",textAlign:"center",padding:"30px 0",lineHeight:1.7}}>
                    👋 무엇이든 물어보세요.<br/>
                    <span style={{fontSize:10}}>예: "Stacking 공정 반복 이슈 원인 분석해줘"<br/>
                    "@PE 이 호기 점검 방법은?"</span>
                  </div>
                ) : chatMessages.map((m, i) => {
                  if (m.role === "user") {
                    return (
                      <div key={i} style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
                        <div style={{
                          maxWidth:"80%", padding:"8px 12px", borderRadius:"12px 12px 2px 12px",
                          background:"rgba(34,211,238,0.15)", border:"1px solid rgba(34,211,238,0.3)",
                          fontSize:11, color:"#e2e8f0", lineHeight:1.5, whiteSpace:"pre-wrap",
                        }}>
                          {m.text}
                          <div style={{fontSize:8,color:"#64748b",marginTop:4,textAlign:"right"}}>{m.time}</div>
                        </div>
                      </div>
                    );
                  }
                  const p = PERSONAS[m.agent] || { label: m.agent || "system", color: "#94a3b8", bg: "rgba(100,116,139,0.1)", icon: "⚙️" };
                  return (
                    <div key={i} style={{display:"flex",flexDirection:"column",marginBottom:10}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <span style={{
                          fontSize:9, padding:"2px 7px", borderRadius:9,
                          background:p.bg, color:p.color, fontWeight:700,
                        }}>{p.icon} {p.label}</span>
                      </div>
                      <div style={{
                        maxWidth:"90%", padding:"8px 12px", borderRadius:"12px 12px 12px 2px",
                        background:"rgba(15,23,42,0.7)", border:`1px solid ${p.color}33`,
                        fontSize:11, color:"#e2e8f0", lineHeight:1.6, whiteSpace:"pre-wrap",
                      }}>
                        {m.text}
                        <div style={{fontSize:8,color:"#64748b",marginTop:4}}>{m.time}</div>
                      </div>
                    </div>
                  );
                })}
                {chatBusy && (
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:10,color:"#94a3b8"}}>
                    <Spinner/> 응답 생성 중...
                  </div>
                )}
              </div>

              {/* 입력창 */}
              <div style={{
                padding:"10px 12px",
                borderTop:"1px solid rgba(51,65,85,0.4)",
                background:"rgba(15,23,42,0.6)",
                display:"flex", gap:8,
              }}>
                <textarea value={chatInput}
                  onChange={(e)=>setChatInput(e.target.value)}
                  onKeyDown={(e)=>{
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChatMessage();
                    }
                  }}
                  placeholder="질문 입력 (Shift+Enter로 줄바꿈, @코드 멘션 가능)"
                  rows={2}
                  disabled={chatBusy}
                  style={{
                    flex:1, padding:"6px 10px", borderRadius:6,
                    background:"rgba(0,0,0,0.3)",
                    border:"1px solid rgba(51,65,85,0.5)",
                    color:"#e2e8f0", fontSize:11, lineHeight:1.5,
                    resize:"none", fontFamily:"inherit",
                  }}/>
                <button onClick={sendChatMessage}
                  disabled={chatBusy || !chatInput.trim()} style={{
                    padding:"0 14px", borderRadius:6,
                    background: (chatBusy || !chatInput.trim()) ? "rgba(51,65,85,0.4)" : "linear-gradient(135deg,#3b82f6,#22d3ee)",
                    border:"none",
                    color: (chatBusy || !chatInput.trim()) ? "#475569" : "#fff",
                    fontSize:11, fontWeight:800,
                    cursor: (chatBusy || !chatInput.trim()) ? "not-allowed" : "pointer",
                  }}>전송</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 논의 카드 컴포넌트 ────────────────────────────────────────────────────────
// ─── ★ 영역 8-B: 날짜 범위 선택 컴포넌트 (통합형: 빠른선택 + 캘린더 + 단위 토글) ──
function DateRangePicker({ availableDates, selRange, onChange }) {
  // availableDates: 데이터에 존재하는 생산일자 배열 (예: ["26/4/8","26/4/9",...])
  // selRange: { start, end, unit }
  const [unit, setUnit] = useState(selRange?.unit || "day");
  const [start, setStart] = useState(selRange?.start || null);
  const [end, setEnd] = useState(selRange?.end || null);
  const [calMonth, setCalMonth] = useState(() => {
    if (selRange?.start) {
      const d = dateStrToDate(selRange.start);
      return { y: d.getFullYear(), m: d.getMonth() };
    }
    if (availableDates?.length > 0) {
      const d = dateStrToDate(availableDates[availableDates.length - 1]);
      return { y: d.getFullYear(), m: d.getMonth() };
    }
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  });

  // availableDates가 비어있으면 빠른선택 기준일 = 오늘, 아니면 데이터의 가장 최신 일자
  const todayBaseStr = availableDates?.length > 0 ? availableDates[availableDates.length - 1] : dateToDateStr(new Date());

  // 변경사항 부모에게 통지 (start/end/unit 또는 dates까지 함께)
  const commit = (s, e, u) => {
    let dates = [];
    if (s && e) dates = expandRange(s, e).filter(d => availableDates.includes(d));
    onChange({ start: s, end: e, unit: u, dates });
  };

  const applyQuick = (preset) => {
    const r = getQuickRange(preset, todayBaseStr);
    if (!r) return;
    const [s, e] = r;
    setStart(s); setEnd(e);
    commit(s, e, unit);
    // 캘린더 보기를 해당 범위 끝달로 이동
    const ed = dateStrToDate(e);
    setCalMonth({ y: ed.getFullYear(), m: ed.getMonth() });
  };

  const handleDayClick = (dateStr) => {
    if (!availableDates.includes(dateStr)) return;
    if (!start || (start && end)) {
      // 새 시작
      setStart(dateStr); setEnd(null);
      commit(dateStr, null, unit);
    } else {
      // 끝 지정 (시작보다 이전이면 swap)
      const sd = dateStrToDate(start);
      const cd = dateStrToDate(dateStr);
      const [s, e] = cd >= sd ? [start, dateStr] : [dateStr, start];
      setStart(s); setEnd(e);
      commit(s, e, unit);
    }
  };

  const handleUnitChange = (newUnit) => {
    setUnit(newUnit);
    // 단위 변경 시 시작/끝 정렬: 주 단위면 해당 주의 월~일, 월 단위면 1일~말일
    if (start && end) {
      if (newUnit === "week") {
        const weeks = getWeeksInRange(start, end);
        if (weeks.length > 0) {
          const newS = weeks[0].start;
          const newE = weeks[weeks.length - 1].end;
          // availableDates 안에 있는 것으로 한정
          const validS = availableDates.find(d => d >= newS) || newS;
          const validE = [...availableDates].reverse().find(d => d <= newE) || newE;
          setStart(validS); setEnd(validE);
          commit(validS, validE, newUnit);
          return;
        }
      }
      if (newUnit === "month") {
        const months = getMonthsInRange(start, end);
        if (months.length > 0) {
          const all = months.flatMap(m => m.dates).filter(d => availableDates.includes(d));
          if (all.length > 0) {
            setStart(all[0]); setEnd(all[all.length - 1]);
            commit(all[0], all[all.length - 1], newUnit);
            return;
          }
        }
      }
    }
    commit(start, end, newUnit);
  };

  // 주/월 단위면 체크박스 목록 표시 (혼합 방식)
  const renderWeekList = () => {
    if (!availableDates || availableDates.length === 0) return null;
    const weeks = getWeeksInRange(availableDates[0], availableDates[availableDates.length - 1]);
    return (
      <div style={{maxHeight:280, overflowY:"auto", padding:"4px"}}>
        {weeks.map(w => {
          const weekDates = expandRange(w.start, w.end).filter(d => availableDates.includes(d));
          if (weekDates.length === 0) return null;
          const isSelected = start && end && start <= w.end && end >= w.start;
          return (
            <div key={w.key} onClick={()=>{
              const validS = weekDates[0];
              const validE = weekDates[weekDates.length - 1];
              setStart(validS); setEnd(validE);
              commit(validS, validE, "week");
            }} style={{
              display:"flex", alignItems:"center", gap:10,
              padding:"8px 10px", borderRadius:6, cursor:"pointer", marginBottom:4,
              background: isSelected ? "rgba(34,211,238,0.1)" : "rgba(15,23,42,0.4)",
              border:`1px solid ${isSelected ? "rgba(34,211,238,0.3)" : "rgba(51,65,85,0.3)"}`,
            }}>
              <div style={{
                width:16, height:16, borderRadius:3,
                background: isSelected ? "#22d3ee" : "transparent",
                border:`2px solid ${isSelected ? "#22d3ee" : "rgba(51,65,85,0.6)"}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:9, color:"#fff", flexShrink:0,
              }}>{isSelected ? "✓" : ""}</div>
              <div style={{flex:1, fontSize:11, color: isSelected ? "#22d3ee" : "#cbd5e1"}}>
                <div style={{fontWeight:700}}>{w.label}</div>
                <div style={{fontSize:9, color:"#64748b"}}>{w.start} ~ {w.end} · 데이터 {weekDates.length}일</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderMonthList = () => {
    if (!availableDates || availableDates.length === 0) return null;
    const months = getMonthsInRange(availableDates[0], availableDates[availableDates.length - 1]);
    return (
      <div style={{maxHeight:280, overflowY:"auto", padding:"4px"}}>
        {months.map(mo => {
          const monthDates = mo.dates.filter(d => availableDates.includes(d));
          if (monthDates.length === 0) return null;
          const isSelected = start && end && monthDates.some(d => d >= start && d <= end);
          return (
            <div key={mo.key} onClick={()=>{
              const validS = monthDates[0];
              const validE = monthDates[monthDates.length - 1];
              setStart(validS); setEnd(validE);
              commit(validS, validE, "month");
            }} style={{
              display:"flex", alignItems:"center", gap:10,
              padding:"8px 10px", borderRadius:6, cursor:"pointer", marginBottom:4,
              background: isSelected ? "rgba(34,211,238,0.1)" : "rgba(15,23,42,0.4)",
              border:`1px solid ${isSelected ? "rgba(34,211,238,0.3)" : "rgba(51,65,85,0.3)"}`,
            }}>
              <div style={{
                width:16, height:16, borderRadius:3,
                background: isSelected ? "#22d3ee" : "transparent",
                border:`2px solid ${isSelected ? "#22d3ee" : "rgba(51,65,85,0.6)"}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:9, color:"#fff", flexShrink:0,
              }}>{isSelected ? "✓" : ""}</div>
              <div style={{flex:1, fontSize:11, color: isSelected ? "#22d3ee" : "#cbd5e1"}}>
                <div style={{fontWeight:700}}>{mo.label}</div>
                <div style={{fontSize:9, color:"#64748b"}}>데이터 {monthDates.length}일</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCalendar = () => {
    const { y, m } = calMonth;
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const startDayOfWeek = firstDay.getDay() === 0 ? 7 : firstDay.getDay(); // 월=1 기준
    const daysInMonth = lastDay.getDate();
    const cells = [];
    // 앞 빈 칸 (월요일 시작 기준)
    for (let i = 1; i < startDayOfWeek; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const dStr = `${String(y).slice(-2)}/${m + 1}/${d}`;
      cells.push(dStr);
    }
    const isInRange = (dStr) => {
      if (!dStr || !start) return false;
      if (!end) return dStr === start;
      return dStr >= start && dStr <= end;
    };
    const isEndpoint = (dStr) => dStr === start || dStr === end;
    const isAvailable = (dStr) => dStr && availableDates.includes(dStr);

    const prevMonth = () => setCalMonth({ y: m === 0 ? y - 1 : y, m: m === 0 ? 11 : m - 1 });
    const nextMonth = () => setCalMonth({ y: m === 11 ? y + 1 : y, m: m === 11 ? 0 : m + 1 });

    return (
      <div>
        {/* 캘린더 헤더 */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <button onClick={prevMonth} style={{
            padding:"4px 10px", background:"rgba(51,65,85,0.3)", border:"1px solid rgba(51,65,85,0.5)",
            borderRadius:5, color:"#cbd5e1", cursor:"pointer", fontSize:11,
          }}>‹</button>
          <div style={{fontSize:13,fontWeight:700,color:"#22d3ee"}}>{y}년 {m + 1}월</div>
          <button onClick={nextMonth} style={{
            padding:"4px 10px", background:"rgba(51,65,85,0.3)", border:"1px solid rgba(51,65,85,0.5)",
            borderRadius:5, color:"#cbd5e1", cursor:"pointer", fontSize:11,
          }}>›</button>
        </div>
        {/* 요일 헤더 */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {["월","화","수","목","금","토","일"].map((w,i) => (
            <div key={w} style={{
              textAlign:"center", fontSize:10, fontWeight:700, padding:"4px 0",
              color: i === 5 ? "#60a5fa" : i === 6 ? "#f87171" : "#94a3b8",
            }}>{w}</div>
          ))}
        </div>
        {/* 날짜 셀 */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {cells.map((dStr, i) => {
            if (!dStr) return <div key={`e-${i}`} style={{height:34}}/>;
            const inRange = isInRange(dStr);
            const isEnd = isEndpoint(dStr);
            const avail = isAvailable(dStr);
            return (
              <button key={dStr}
                onClick={()=>handleDayClick(dStr)}
                disabled={!avail}
                style={{
                  height:34, padding:0, fontSize:11,
                  background: isEnd ? "#22d3ee" : (inRange ? "rgba(34,211,238,0.15)" : "transparent"),
                  border:`1px solid ${isEnd ? "#22d3ee" : (inRange ? "rgba(34,211,238,0.3)" : "rgba(51,65,85,0.2)")}`,
                  borderRadius:5,
                  color: isEnd ? "#0c1220" : (inRange ? "#22d3ee" : (avail ? "#cbd5e1" : "#475569")),
                  fontWeight: isEnd ? 800 : (avail ? 600 : 400),
                  cursor: avail ? "pointer" : "not-allowed",
                  opacity: avail ? 1 : 0.4,
                }}
                title={avail ? `${dStr} (데이터 있음)` : `${dStr} (데이터 없음)`}
              >
                {parseInt(dStr.split("/")[2], 10)}
              </button>
            );
          })}
        </div>
        <div style={{fontSize:9, color:"#64748b", marginTop:6, textAlign:"center"}}>
          ※ 첫 클릭=시작, 두번째 클릭=끝 / 데이터 있는 날짜만 선택 가능
        </div>
      </div>
    );
  };

  const presets = [
    { id: "today",     label: "오늘" },
    { id: "yesterday", label: "어제" },
    { id: "thisWeek",  label: "이번 주" },
    { id: "lastWeek",  label: "지난 주" },
    { id: "thisMonth", label: "이번 달" },
    { id: "lastMonth", label: "지난 달" },
    { id: "last7",     label: "최근 7일" },
    { id: "last30",    label: "최근 30일" },
  ];

  return (
    <div>
      {/* 빠른 선택 */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,marginBottom:6}}>빠른 선택</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
          {presets.map(p => (
            <button key={p.id} onClick={()=>applyQuick(p.id)} style={{
              padding:"5px 10px", borderRadius:5,
              background:"rgba(34,211,238,0.06)", border:"1px solid rgba(34,211,238,0.2)",
              color:"#22d3ee", fontSize:10, fontWeight:700, cursor:"pointer",
            }}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* 단위 토글 */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,marginBottom:6}}>보기 단위</div>
        <div style={{display:"flex",gap:4, background:"rgba(15,23,42,0.5)", padding:3, borderRadius:6}}>
          {[
            {v:"day",   l:"일"},
            {v:"week",  l:"주"},
            {v:"month", l:"월"},
          ].map(opt => (
            <button key={opt.v} onClick={()=>handleUnitChange(opt.v)} style={{
              flex:1, padding:"6px 10px", borderRadius:4,
              background: unit === opt.v ? "linear-gradient(135deg,#3b82f6,#22d3ee)" : "transparent",
              border:"none", color: unit === opt.v ? "#fff" : "#94a3b8",
              fontSize:11, fontWeight:700, cursor:"pointer",
            }}>{opt.l}</button>
          ))}
        </div>
      </div>

      {/* 단위에 따라 다른 UI */}
      <div style={{
        background:"rgba(4,8,16,0.6)", border:"1px solid rgba(51,65,85,0.3)",
        borderRadius:8, padding:"12px", marginBottom:10,
      }}>
        {unit === "day"   && renderCalendar()}
        {unit === "week"  && renderWeekList()}
        {unit === "month" && renderMonthList()}
      </div>

      {/* 선택 결과 표시 */}
      {start && end ? (
        <div style={{
          fontSize:11, color:"#22d3ee", padding:"8px 12px",
          background:"rgba(34,211,238,0.08)", border:"1px solid rgba(34,211,238,0.25)",
          borderRadius:6, fontWeight:700,
        }}>
          ✓ {buildRangeLabel({ start, end, unit })}
        </div>
      ) : start ? (
        <div style={{fontSize:11, color:"#f59e0b", padding:"8px 12px"}}>
          ⏳ 시작 일자: {start} (끝 일자를 선택하세요)
        </div>
      ) : (
        <div style={{fontSize:11, color:"#64748b", padding:"8px 12px"}}>
          기간을 선택하세요
        </div>
      )}
    </div>
  );
}

// ─── ★ 영역 9-E: 간단모드 보고서 컴포넌트 (명세서 §6 표 형태) ──────────────────
// ─── ★ 영역 11-D + 11-K: 이슈 브리핑 표시 컴포넌트 (HTML 레포트 1~5번 + 인라인 체크박스) ──────────
// props:
//   curation: PE 큐레이션 결과 (영역 11-C 스키마)
//   allIssues: taggedIssues.issues (체크 매칭에 사용)
//   selectedIds: 현재 체크된 이슈 ID 배열
//   autoSelectedIds: 자동 선정 ID (⭐ 표시용)
//   onToggle: (issueId) => void
//   onToggleMany: (issueIds[], shouldCheck) => void  (그룹 일괄)
function BriefingDisplay({ curation, allIssues = [], selectedIds = [], autoSelectedIds = [], onToggle, onToggleMany, discussions = [] }) {
  if (!curation) return null;

  const sectionStyle = {
    background:"rgba(15,23,42,0.6)", border:"1px solid rgba(100,116,139,0.25)",
    borderRadius:10, padding:"14px 16px", marginBottom:14,
  };
  const headingStyle = {
    fontSize:13, fontWeight:800, marginBottom:10,
    paddingBottom:6, borderBottom:"1px solid rgba(51,65,85,0.4)",
  };
  const tableStyle = { width:"100%", fontSize:10.5, color:"#cbd5e1", borderCollapse:"collapse" };
  const thStyle = {
    padding:"5px 8px", background:"rgba(51,65,85,0.4)",
    color:"#94a3b8", fontWeight:700, textAlign:"left",
    border:"1px solid rgba(51,65,85,0.4)",
  };
  const tdStyle = { padding:"5px 8px", border:"1px solid rgba(51,65,85,0.3)", verticalAlign:"top" };
  const empty = (msg) => <div style={{fontSize:10,color:"#64748b",padding:"8px 0"}}>{msg}</div>;

  // ─── 영역 11-K: 매칭/체크박스 헬퍼 ─────────────────────────────────────────
  // 큐레이션 longDowntime[i] → 실제 allIssues에서 매칭되는 이슈 찾기
  // 매칭 룰: equipment + (분 또는 시간 ±10분)
  const findMatchingIssue = (curationItem) => {
    if (!curationItem.equipment) return null;
    const candidates = allIssues.filter(i => i.eq === curationItem.equipment);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    // 부동시간으로 좁히기
    if (curationItem.durationMin) {
      const byDur = candidates.find(i => Math.abs((i.durMin || 0) - curationItem.durationMin) < 5);
      if (byDur) return byDur;
    }
    // 가장 긴 부동 선택
    return candidates.sort((a, b) => (b.durMin || 0) - (a.durMin || 0))[0];
  };
  // 카테고리/설비별 이슈 묶음 추출 — equipments 배열에서 STK 코드 파싱
  const findIssuesByEquipmentList = (equipmentsList) => {
    if (!Array.isArray(equipmentsList)) return [];
    const eqCodes = equipmentsList.map(s => {
      // "STK-1-A4(×2)" 또는 "STK-1-A4 (관련)" → "STK-1-A4"
      const m = (s || "").match(/(STK[-\d\w]+|Cutter[\s\d\w()+\-]+)/i);
      return m ? m[1].trim() : (s || "").split(/[\s(×]/)[0].trim();
    }).filter(Boolean);
    return allIssues.filter(i => i.eq && eqCodes.some(eq => i.eq.includes(eq) || eq.includes(i.eq)));
  };
  const findIssuesByEquipment = (equipment) => {
    if (!equipment) return [];
    return allIssues.filter(i => i.eq === equipment);
  };
  // 그룹 체크 상태 계산 (all/none/partial)
  const groupCheckState = (issueIds) => {
    if (issueIds.length === 0) return "none";
    const checked = issueIds.filter(id => selectedIds.includes(id)).length;
    if (checked === 0) return "none";
    if (checked === issueIds.length) return "all";
    return "partial";
  };

  // ─── Phase 2: 페르소나 논의 매칭 헬퍼 ───
  // 큐레이션 이슈 → 매칭되는 페르소나 논의 (discussions)
  const findMatchingDiscussion = (curationItem) => {
    if (!discussions || discussions.length === 0) return null;
    if (!curationItem || !curationItem.equipment) return null;
    // 1순위: equipment + durMin 일치
    let match = discussions.find(d =>
      d.issue?.eq === curationItem.equipment &&
      curationItem.durationMin &&
      Math.abs((d.issue?.durMin || 0) - curationItem.durationMin) < 5
    );
    if (match) return match;
    // 2순위: equipment 일치 (가장 부동시간 긴 것)
    match = discussions
      .filter(d => d.issue?.eq === curationItem.equipment)
      .sort((a, b) => (b.issue?.durMin || 0) - (a.issue?.durMin || 0))[0];
    return match || null;
  };
  // 매칭된 모든 discussion id 모음 (Appendix에서 매칭 안 된 것 식별용)
  const matchedDiscussionKeys = new Set();
  const markMatched = (d) => { if (d && d.issue) matchedDiscussionKeys.add(getIssueId(d.issue)); };

  // 일반 이슈 → 매칭되는 discussion (allIssues에서 사용)
  const findMatchingDiscussionByIssue = (issue) => {
    if (!discussions || !issue) return null;
    return discussions.find(d => getIssueId(d.issue) === getIssueId(issue)) || null;
  };
  // 인라인 체크박스 렌더 (이슈 1건)
  const IssueCheckbox = ({ issue, label = null, compact = false }) => {
    if (!issue || !onToggle) return null;
    const id = getIssueId(issue);
    const checked = selectedIds.includes(id);
    const isAuto = autoSelectedIds.includes(id);
    return (
      <label style={{
        display:"inline-flex", alignItems:"center", gap:6, cursor:"pointer",
        padding: compact ? "0" : "2px 4px", borderRadius:4,
        background: checked ? "rgba(34,211,238,0.08)" : "transparent",
      }}>
        <input type="checkbox" checked={checked}
          onChange={() => onToggle(id)}
          style={{cursor:"pointer", accentColor:"#22d3ee", margin:0}}/>
        {isAuto && <span style={{fontSize:10,color:"#fbbf24",fontWeight:700}}>⭐</span>}
        {label && <span style={{fontSize:10,color: checked ? "#22d3ee" : "#94a3b8"}}>{label}</span>}
      </label>
    );
  };
  // 그룹 헤더 체크박스 (3-state)
  const GroupCheckbox = ({ issueIds, label = null }) => {
    if (issueIds.length === 0 || !onToggleMany) return null;
    const state = groupCheckState(issueIds);
    return (
      <label style={{display:"inline-flex", alignItems:"center", gap:6, cursor:"pointer"}}>
        <input
          type="checkbox"
          checked={state === "all"}
          ref={el => { if (el) el.indeterminate = state === "partial"; }}
          onChange={() => onToggleMany(issueIds, state !== "all")}
          style={{cursor:"pointer", accentColor:"#22d3ee", margin:0}}/>
        {label && <span style={{fontSize:10,color: state === "all" ? "#22d3ee" : "#94a3b8"}}>{label}</span>}
      </label>
    );
  };
  // 펼침 토글 state
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showShortDowntime, setShowShortDowntime] = useState(false);
  const toggleGroup = (key) => setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));

  // 1번에 표시되지 않은 짧은 부동 이슈 (펼침 영역용)
  const longDowntimeMatched = (curation.longDowntime || []).map(findMatchingIssue).filter(Boolean);
  const longDowntimeIds = longDowntimeMatched.map(getIssueId);
  const shortDowntimeIssues = allIssues.filter(i => !longDowntimeIds.includes(getIssueId(i)));

  return (
    <div>
      {/* 0. 핵심 요약 박스 (TL;DR) */}
      {(curation.criticalSummary?.length > 0 || curation.summary_text) && (
        <div style={{
          background:"rgba(167,139,250,0.06)",
          border:"2px solid rgba(167,139,250,0.3)",
          borderRadius:10, padding:"14px 18px", marginBottom:14,
        }}>
          <div style={{fontSize:13,fontWeight:800,color:"#a78bfa",marginBottom:8}}>
            📋 핵심 요약
          </div>
          {/* ★ 12-Y1: 레코드 분류 */}
          {curation.recordBreakdown && (curation.recordBreakdown.bmDowntime || curation.recordBreakdown.ubm || curation.recordBreakdown.pdDowntime || curation.recordBreakdown.other) > 0 && (
            <div style={{
              fontSize:10, color:"#94a3b8", marginBottom:8,
              padding:"5px 10px", background:"rgba(0,0,0,0.2)", borderRadius:5,
            }}>
              <span style={{fontWeight:700,color:"#cbd5e1"}}>레코드:</span>
              {curation.recordBreakdown.bmDowntime > 0 && <span> BM Downtime Bot {curation.recordBreakdown.bmDowntime}건</span>}
              {curation.recordBreakdown.ubm > 0 && <span> · UBM {curation.recordBreakdown.ubm}건</span>}
              {curation.recordBreakdown.pdDowntime > 0 && <span> · PD Downtime {curation.recordBreakdown.pdDowntime}건</span>}
              {curation.recordBreakdown.other > 0 && <span> · 기타 {curation.recordBreakdown.other}건</span>}
            </div>
          )}
          {curation.summary_text && (
            <div style={{fontSize:11,color:"#cbd5e1",marginBottom:8,fontStyle:"italic",lineHeight:1.6}}>
              {curation.summary_text}
            </div>
          )}
          {curation.criticalSummary?.length > 0 && (
            <ul style={{margin:"6px 0 0 0",paddingLeft:18,fontSize:11,color:"#cbd5e1",lineHeight:1.7}}>
              {curation.criticalSummary.map((item, i) => (
                <li key={i} style={{marginBottom:3}}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 1. 장기부동 상세 */}
      <div style={sectionStyle}>
        <div style={{...headingStyle,color:"#ef4444"}}>🚨 1. 장기부동 건 — 상세</div>
        {(!curation.longDowntime || curation.longDowntime.length === 0) ? empty("장기부동 이슈 없음") : (
          <div>
            {curation.longDowntime.map((d, idx) => {
              const isTop = d.isTop;
              const matchedIssue = findMatchingIssue(d);
              return (
                <div key={idx} style={{
                  background: isTop ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.06)",
                  border:`1px solid ${isTop ? "#ef4444" : "#f59e0b"}33`,
                  borderLeft:`5px solid ${isTop ? "#ef4444" : "#f59e0b"}`,
                  borderRadius:6, padding:"10px 14px", marginBottom:10,
                }}>
                  <div style={{
                    display:"flex", alignItems:"center", gap:10,
                    marginBottom:6,
                  }}>
                    {matchedIssue && (
                      <IssueCheckbox issue={matchedIssue} compact={true}/>
                    )}
                    <div style={{fontSize:12,fontWeight:800,color:isTop?"#ef4444":"#f59e0b",flex:1}}>
                      {isTop ? "🔴 [TOP] " : "🔴 "}{d.title || `${d.equipment} (${d.durationMin}분)`}
                    </div>
                    {matchedIssue && autoSelectedIds.includes(getIssueId(matchedIssue)) && (
                      <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,
                        background:"rgba(245,158,11,0.15)",color:"#fbbf24",fontWeight:700}}>⭐ 자동선정</span>
                    )}
                  </div>
                  <table style={{...tableStyle, fontSize:10.5}}>
                    <tbody>
                      {d.occurrence && <tr><th style={{...thStyle,width:"22%"}}>발생</th><td style={tdStyle}>{d.occurrence}</td></tr>}
                      {d.alarm && <tr><th style={thStyle}>알람</th><td style={{...tdStyle,fontFamily:"monospace",fontSize:9.5}}>{d.alarm}</td></tr>}
                      {d.splitNote && <tr><th style={thStyle}>보고 형태</th><td style={{...tdStyle,color:"#fcd34d"}}>{d.splitNote}</td></tr>}
                      {d.rootCause && <tr><th style={thStyle}>근본 원인</th><td style={{...tdStyle,fontWeight:700,color:"#fca5a5"}}>{d.rootCause}</td></tr>}
                      {d.partReplaced && <tr><th style={thStyle}>부품 교체</th><td style={{...tdStyle,fontWeight:700}}>{d.partReplaced}</td></tr>}
                      {d.collateralDamage && <tr><th style={thStyle}>부수 피해</th><td style={{...tdStyle,fontWeight:700,color:"#fbbf24"}}>{d.collateralDamage}</td></tr>}
                      {d.pic && <tr><th style={thStyle}>PIC</th><td style={tdStyle}>{d.pic}</td></tr>}
                      {d.result && <tr><th style={thStyle}>결과</th><td style={{...tdStyle,color:d.result.toLowerCase().includes("solved")?"#34d399":"#fbbf24"}}>{d.result}</td></tr>}
                    </tbody>
                  </table>
                  {/* ★ 12-Y1: 분할 보고 정밀 분석 */}
                  {d.splitDetail?.length > 0 && (
                    <div style={{marginTop:8, padding:"8px 10px", background:"rgba(252,211,77,0.06)", borderLeft:"3px solid #fcd34d", borderRadius:4}}>
                      <div style={{fontSize:10.5,fontWeight:700,color:"#fcd34d",marginBottom:4}}>📊 분할 보고 분석</div>
                      {d.splitDetail.map((sd, sdi) => (
                        <div key={sdi} style={{fontSize:10,color:"#cbd5e1",marginBottom:3,paddingLeft:8}}>
                          <span style={{fontWeight:700,color:"#fbbf24"}}>{sd.order}차</span> — <b>{sd.duration}분</b> ({sd.time})
                          {sd.gapMin && <span style={{color:"#fca5a5",marginLeft:6,fontWeight:700}}>· 1차 후 {sd.gapMin}분만에 재발</span>}
                          {sd.description && <div style={{marginTop:1,color:"#94a3b8"}}>→ {sd.description}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* ★ 12-Y1: 재발 간격 (splitDetail 없는 경우 단독 표시) */}
                  {d.recurrenceGap && !d.splitDetail?.length && (
                    <div style={{marginTop:6, padding:"6px 10px", background:"rgba(252,211,77,0.06)", borderLeft:"3px solid #fcd34d", borderRadius:4, fontSize:10, color:"#fcd34d", fontWeight:700}}>
                      ⏱️ {d.recurrenceGap}
                    </div>
                  )}
                  {/* ★ 12-Y1: 이력 패턴 */}
                  {d.historyPattern && (
                    <div style={{marginTop:6, padding:"6px 10px", background:"rgba(167,139,250,0.06)", borderLeft:"3px solid #a78bfa", borderRadius:4, fontSize:10, color:"#cbd5e1"}}>
                      <span style={{fontWeight:700,color:"#c4b5fd"}}>🔍 이력 패턴:</span> {d.historyPattern}
                    </div>
                  )}
                  {d.actionSequence?.length > 0 && (
                    <div style={{marginTop:10}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#94a3b8",marginBottom:4}}>
                        적용 조치 ({d.actionSequence.length}단계)
                      </div>
                      <ol style={{margin:0,paddingLeft:18,fontSize:10,color:"#cbd5e1",lineHeight:1.6}}>
                        {d.actionSequence.map((step, si) => (
                          <li key={si} style={{marginBottom:2}}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {/* ★ 12-Y1: 조치 분석 */}
                  {d.actionAnalysis && (
                    <div style={{marginTop:6, padding:"6px 10px", background:"rgba(239,68,68,0.06)", borderLeft:"3px solid #ef4444", borderRadius:4, fontSize:10, color:"#fca5a5", fontStyle:"italic"}}>
                      ⚠️ {d.actionAnalysis}
                    </div>
                  )}
                  {/* ★ Phase 2: 매칭되는 페르소나 논의 표시 */}
                  {(() => {
                    const matched = findMatchingDiscussion(d);
                    if (!matched) return null;
                    markMatched(matched);
                    return <PersonaConversation discussion={matched}/>;
                  })()}
                </div>
              );
            })}
          </div>
        )}

        {/* 영역 11-K: 짧은 부동 이슈 펼침 영역 (1번 섹션 안) */}
        {shortDowntimeIssues.length > 0 && (
          <div style={{marginTop:10, paddingTop:10, borderTop:"1px dashed rgba(100,116,139,0.3)"}}>
            <button onClick={() => setShowShortDowntime(!showShortDowntime)} style={{
              fontSize:10, padding:"5px 10px", borderRadius:5,
              background:"rgba(100,116,139,0.1)", border:"1px solid rgba(100,116,139,0.3)",
              color:"#94a3b8", cursor:"pointer", fontWeight:700,
            }}>
              {showShortDowntime ? "▼" : "▶"} 기타 짧은 부동 이슈 ({shortDowntimeIssues.length}건) — 추가 논의 후보
            </button>
            {showShortDowntime && (
              <div style={{marginTop:8, maxHeight:600, overflowY:"auto"}}>
                {shortDowntimeIssues.map((i) => {
                  const id = getIssueId(i);
                  const checked = selectedIds.includes(id);
                  const matched = findMatchingDiscussionByIssue(i);
                  if (matched) markMatched(matched);
                  return (
                    <div key={id} style={{marginBottom: 6}}>
                      <label style={{
                        display:"flex", alignItems:"flex-start", gap:8,
                        padding:"6px 8px", borderRadius:5,
                        background: checked ? "rgba(34,211,238,0.05)" : "rgba(15,23,42,0.3)",
                        border:`1px solid ${checked ? "rgba(34,211,238,0.25)" : "rgba(51,65,85,0.25)"}`,
                        cursor:"pointer", fontSize:10,
                      }}>
                        <input type="checkbox" checked={checked}
                          onChange={() => onToggle(id)}
                          style={{marginTop:2, cursor:"pointer", accentColor:"#22d3ee"}}/>
                        <div style={{flex:1, lineHeight:1.5}}>
                          <span style={{color:"#94a3b8"}}>{i.date} {i.time}</span>
                          {" · "}
                          <span style={{color:"#cbd5e1",fontWeight:700,fontFamily:"monospace"}}>{i.eq || "-"}</span>
                          {" · "}
                          <span style={{color:"#94a3b8"}}>{i.durMin}분</span>
                          {i.prob && <div style={{color:"#cbd5e1",fontSize:9.5}}>{i.prob.slice(0, 80)}</div>}
                        </div>
                      </label>
                      {/* ★ Phase 2: 매칭되는 페르소나 논의 (체크박스 카드 아래) */}
                      {matched && <PersonaConversation discussion={matched}/>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ★ 영역 12-Y4: 만성 이슈 추적 (24h+ open 또는 cross-day 반복) */}
      {curation.chronicIssues?.length > 0 && (
        <div style={sectionStyle}>
          <div style={{...headingStyle, color:"#dc2626"}}>🔥 만성 이슈 추적 (별도)</div>
          <div style={{fontSize:10, color:"#94a3b8", marginBottom:10, fontStyle:"italic"}}>
            24시간 이상 open 상태이거나 여러 일자에 걸쳐 반복되는 만성 이슈입니다.
          </div>
          {curation.chronicIssues.map((c, idx) => (
            <div key={idx} style={{
              background:"rgba(220,38,38,0.06)",
              border:"1px solid rgba(220,38,38,0.3)",
              borderLeft:"5px solid #dc2626",
              borderRadius:6, padding:"10px 14px", marginBottom:10,
            }}>
              <div style={{fontSize:12, fontWeight:800, color:"#fca5a5", marginBottom:6}}>
                ⚠️ {c.title || c.equipment}
              </div>
              <table style={{...tableStyle, fontSize:10.5}}>
                <tbody>
                  {c.startedAt && <tr><th style={{...thStyle,width:"22%"}}>시작</th><td style={tdStyle}>{c.startedAt}</td></tr>}
                  {c.currentStatus && <tr><th style={thStyle}>현재 상태</th><td style={{...tdStyle,fontWeight:700,color:"#fbbf24"}}>{c.currentStatus}</td></tr>}
                  {c.managerInvolved && <tr><th style={thStyle}>관련 관리</th><td style={{...tdStyle,color:"#fca5a5",fontWeight:700}}>{c.managerInvolved}</td></tr>}
                </tbody>
              </table>
              {c.history?.length > 0 && (
                <div style={{marginTop:8}}>
                  <div style={{fontSize:10.5, fontWeight:700, color:"#94a3b8", marginBottom:4}}>이력</div>
                  <ul style={{margin:0, paddingLeft:18, fontSize:10, color:"#cbd5e1", lineHeight:1.6}}>
                    {c.history.map((h, hi) => <li key={hi} style={{marginBottom:2}}>{h}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 2. 발생빈도 — 영역 11-K: 그룹 헤더 체크박스 + 펼침 시 개별 체크박스 */}
      <div style={sectionStyle}>
        <div style={{...headingStyle,color:"#f59e0b"}}>🔁 2. 발생빈도 높은 이슈</div>

        {/* 카테고리별 */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:"#fcd34d",marginBottom:6}}>카테고리별</div>
          {(!curation.recurringByCategory || curation.recurringByCategory.length === 0) ? empty("반복 카테고리 없음") : (
            <div>
              {curation.recurringByCategory.map((c, i) => {
                const groupKey = `cat-${i}`;
                const groupIssues = findIssuesByEquipmentList(c.equipments);
                const groupIds = groupIssues.map(getIssueId);
                const expanded = expandedGroups[groupKey];
                const state = groupCheckState(groupIds);
                return (
                  <div key={i} style={{
                    marginBottom:4,
                    border:"1px solid rgba(51,65,85,0.3)", borderRadius:5,
                    background: state === "all" ? "rgba(34,211,238,0.04)" : "rgba(15,23,42,0.4)",
                  }}>
                    {/* 헤더 행 */}
                    <div style={{
                      display:"flex", alignItems:"center", gap:8,
                      padding:"6px 10px",
                    }}>
                      <GroupCheckbox issueIds={groupIds}/>
                      <button onClick={() => toggleGroup(groupKey)} style={{
                        background:"transparent", border:"none", cursor:"pointer",
                        color:"#94a3b8", fontSize:10, padding:"0 4px",
                      }}>{expanded ? "▼" : "▶"}</button>
                      <div style={{flex:1, fontSize:10.5, fontWeight:700, color:"#cbd5e1"}}>
                        {c.category}
                      </div>
                      <span style={{
                        fontSize:10, fontWeight:700,
                        color:c.count>=3?"#ef4444":"#f59e0b",
                      }}>{c.count}건</span>
                      <span style={{fontSize:9, color:"#64748b", fontFamily:"monospace", maxWidth:280, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                        {(c.equipments || []).join(", ")}
                      </span>
                    </div>
                    {/* 펼침 시 개별 이슈 */}
                    {expanded && groupIssues.length > 0 && (
                      <div style={{padding:"4px 10px 8px 32px"}}>
                        {groupIssues.map(iss => {
                          const id = getIssueId(iss);
                          const checked = selectedIds.includes(id);
                          const isAuto = autoSelectedIds.includes(id);
                          const matched = findMatchingDiscussionByIssue(iss);
                          if (matched) markMatched(matched);
                          return (
                            <div key={id} style={{marginBottom: 4}}>
                              <label style={{
                                display:"flex", alignItems:"flex-start", gap:6,
                                padding:"3px 4px", fontSize:9.5,
                                color:checked ? "#cbd5e1" : "#94a3b8",
                                cursor:"pointer",
                              }}>
                                <input type="checkbox" checked={checked}
                                  onChange={() => onToggle(id)}
                                  style={{cursor:"pointer", accentColor:"#22d3ee", margin:"2px 0"}}/>
                                {isAuto && <span style={{color:"#fbbf24",fontWeight:700}}>⭐</span>}
                                <span style={{flex:1}}>
                                  <span style={{fontFamily:"monospace",fontWeight:700}}>{iss.eq || "-"}</span>
                                  {" · "}{iss.date} {iss.time}
                                  {" · "}{iss.durMin}분
                                  {iss.prob && <span style={{color:"#64748b"}}> — {iss.prob.slice(0, 50)}</span>}
                                </span>
                              </label>
                              {/* ★ Phase 2: 매칭 논의 */}
                              {matched && <PersonaConversation discussion={matched}/>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 동일 설비 다발 */}
        {curation.recurringSameEquipment?.length > 0 && (
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"#fcd34d",marginBottom:6}}>동일 설비 다발</div>
            <div>
              {curation.recurringSameEquipment.map((e, i) => {
                const groupKey = `eq-${i}`;
                const groupIssues = findIssuesByEquipment(e.equipment);
                const groupIds = groupIssues.map(getIssueId);
                const expanded = expandedGroups[groupKey];
                const state = groupCheckState(groupIds);
                return (
                  <div key={i} style={{
                    marginBottom:4,
                    border:"1px solid rgba(51,65,85,0.3)", borderRadius:5,
                    background: state === "all" ? "rgba(34,211,238,0.04)" : "rgba(15,23,42,0.4)",
                  }}>
                    <div style={{display:"flex", alignItems:"center", gap:8, padding:"6px 10px"}}>
                      <GroupCheckbox issueIds={groupIds}/>
                      <button onClick={() => toggleGroup(groupKey)} style={{
                        background:"transparent", border:"none", cursor:"pointer",
                        color:"#94a3b8", fontSize:10, padding:"0 4px",
                      }}>{expanded ? "▼" : "▶"}</button>
                      <span style={{fontFamily:"monospace",fontWeight:700,color:"#fcd34d", fontSize:10.5}}>{e.equipment}</span>
                      <span style={{fontSize:10, color:"#cbd5e1", flex:1}}>
                        {": "}{e.count}건{e.detail ? ` — ${e.detail}` : ""}
                      </span>
                    </div>
                    {/* ★ 12-Y2: 재발 간격 분석 */}
                    {(e.gapAnalysis || e.totalDuration || e.partsReplaced) && (
                      <div style={{padding:"4px 12px 6px 32px", fontSize:9.5, color:"#fcd34d", lineHeight:1.6}}>
                        {e.gapAnalysis && <div>⏱️ {e.gapAnalysis}</div>}
                        {e.totalDuration && <div style={{color:"#fbbf24",fontWeight:700}}>📊 누적: {e.totalDuration}</div>}
                        {e.partsReplaced && <div style={{color:"#94a3b8"}}>🔧 교체: {e.partsReplaced}</div>}
                      </div>
                    )}
                    {expanded && groupIssues.length > 0 && (
                      <div style={{padding:"4px 10px 8px 32px"}}>
                        {groupIssues.map(iss => {
                          const id = getIssueId(iss);
                          const checked = selectedIds.includes(id);
                          const isAuto = autoSelectedIds.includes(id);
                          const matched = findMatchingDiscussionByIssue(iss);
                          if (matched) markMatched(matched);
                          return (
                            <div key={id} style={{marginBottom: 4}}>
                              <label style={{
                                display:"flex", alignItems:"flex-start", gap:6,
                                padding:"3px 4px", fontSize:9.5,
                                color:checked ? "#cbd5e1" : "#94a3b8", cursor:"pointer",
                              }}>
                                <input type="checkbox" checked={checked}
                                  onChange={() => onToggle(id)}
                                  style={{cursor:"pointer", accentColor:"#22d3ee", margin:"2px 0"}}/>
                                {isAuto && <span style={{color:"#fbbf24",fontWeight:700}}>⭐</span>}
                                <span style={{flex:1}}>
                                  {iss.date} {iss.time} · {iss.durMin}분
                                  {iss.prob && <span style={{color:"#64748b"}}> — {iss.prob.slice(0, 60)}</span>}
                                </span>
                              </label>
                              {matched && <PersonaConversation discussion={matched}/>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. 조건 변경 */}
      <div style={sectionStyle}>
        <div style={{...headingStyle,color:"#34d399"}}>⚙️ 3. 설비/공정 조건 변경</div>

        {/* ★ 12-Y2: 호기별 통합 그룹 (사용자 레포트 양식) */}
        {curation.conditionChangeGroups?.length > 0 && (
          <div style={{marginBottom:14}}>
            {curation.conditionChangeGroups.map((g, gi) => (
              <div key={gi} style={{
                background:"rgba(52,211,153,0.05)",
                border:"1px solid rgba(52,211,153,0.25)",
                borderLeft:"4px solid #34d399",
                borderRadius:6, padding:"10px 14px", marginBottom:10,
              }}>
                <div style={{fontSize:11.5, fontWeight:800, color:"#86efac", marginBottom:4}}>
                  {g.title || g.equipment}
                  {g.timeRange && <span style={{color:"#94a3b8",fontWeight:400,marginLeft:6,fontSize:10}}>({g.timeRange}{g.shift ? `, ${g.shift}` : ""})</span>}
                </div>
                {g.picReason && (
                  <div style={{fontSize:10, color:"#94a3b8", marginBottom:6, fontStyle:"italic"}}>
                    {g.picReason}
                  </div>
                )}
                {g.parameters?.length > 0 && (
                  <table style={{...tableStyle, fontSize:10, marginBottom:6}}>
                    <thead><tr><th style={thStyle}>파라미터</th><th style={thStyle}>Before → After</th></tr></thead>
                    <tbody>
                      {g.parameters.map((p, pi) => (
                        <tr key={pi}>
                          <td style={tdStyle}>{p.parameter}</td>
                          <td style={{...tdStyle,fontWeight:700,color:"#86efac"}}>
                            {p.before} → <span style={{color:"#34d399"}}>{p.after}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {g.verification && (
                  <div style={{fontSize:10, color:"#34d399", padding:"4px 8px", background:"rgba(52,211,153,0.08)", borderRadius:4}}>
                    ✅ {g.verification}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {curation.conditionChanges?.visionOffset?.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#86efac",marginBottom:6}}>Vision Offset 적용</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>시간</th><th style={thStyle}>설비</th><th style={thStyle}>변경 내용</th><th style={thStyle}>사유</th></tr></thead>
              <tbody>
                {curation.conditionChanges.visionOffset.map((c, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{c.date} {c.time}</td>
                    <td style={{...tdStyle,fontWeight:700,fontFamily:"monospace"}}>{c.equipment}</td>
                    <td style={tdStyle}>{c.change}</td>
                    <td style={tdStyle}>{c.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {curation.conditionChanges?.settingChange?.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#86efac",marginBottom:6}}>Setting 변경 (Before → After)</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>설비</th><th style={thStyle}>파라미터</th><th style={thStyle}>Before → After</th></tr></thead>
              <tbody>
                {curation.conditionChanges.settingChange.map((s, i) => (
                  <tr key={i}>
                    <td style={{...tdStyle,fontFamily:"monospace"}}>{s.equipment || "-"}</td>
                    <td style={tdStyle}>{s.parameter}</td>
                    <td style={tdStyle}>{s.before} → <strong style={{color:"#34d399"}}>{s.after}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {curation.conditionChanges?.cutter?.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#86efac",marginBottom:6}}>Cutter 조정</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>시간</th><th style={thStyle}>설비</th><th style={thStyle}>변경 내용</th></tr></thead>
              <tbody>
                {curation.conditionChanges.cutter.map((c, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{c.date} {c.time}</td>
                    <td style={{...tdStyle,fontFamily:"monospace"}}>{c.equipment}</td>
                    <td style={tdStyle}>{c.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {curation.conditionChanges?.other?.length > 0 && (
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"#86efac",marginBottom:6}}>기타</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>날짜</th><th style={thStyle}>설비</th><th style={thStyle}>변경 내용</th><th style={thStyle}>담당</th></tr></thead>
              <tbody>
                {curation.conditionChanges.other.map((c, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{c.date}</td>
                    <td style={{...tdStyle,fontFamily:"monospace"}}>{c.equipment}</td>
                    <td style={tdStyle}>{c.change}</td>
                    <td style={tdStyle}>{c.pic || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(!curation.conditionChanges ||
          (!curation.conditionChanges.visionOffset?.length &&
           !curation.conditionChanges.settingChange?.length &&
           !curation.conditionChanges.cutter?.length &&
           !curation.conditionChanges.other?.length)) && empty("조건 변경 없음")}
      </div>

      {/* 4. 테스트/PM */}
      <div style={sectionStyle}>
        <div style={{...headingStyle,color:"#22d3ee"}}>🧪 4. 테스트 / PM 활동</div>

        {curation.testPm?.linePM?.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#7dd3fc",marginBottom:6}}>Line PM 계획</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>일자</th><th style={thStyle}>라인</th><th style={thStyle}>상태</th></tr></thead>
              <tbody>
                {curation.testPm.linePM.map((p, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{p.date}</td>
                    <td style={{...tdStyle,fontWeight:700}}>{p.line}</td>
                    <td style={tdStyle}>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {curation.testPm?.fmvs?.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#7dd3fc",marginBottom:6}}>FMVS (Vision Camera)</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>일자</th><th style={thStyle}>작업</th><th style={thStyle}>대상 설비</th></tr></thead>
              <tbody>
                {curation.testPm.fmvs.map((f, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{f.date}</td>
                    <td style={tdStyle}>{f.action}</td>
                    <td style={{...tdStyle,fontSize:9.5}}>{f.equipments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {curation.testPm?.cutter?.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:11,fontWeight:700,color:"#7dd3fc",marginBottom:6}}>Cutter 테스트</div>
            <table style={tableStyle}>
              <thead><tr><th style={thStyle}>시간</th><th style={thStyle}>항목</th><th style={thStyle}>결과</th></tr></thead>
              <tbody>
                {curation.testPm.cutter.map((c, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{c.date} {c.time}</td>
                    <td style={tdStyle}>{c.item}</td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize:14,
                        color: c.resultIcon === "✅" ? "#34d399" :
                               c.resultIcon === "❌" ? "#ef4444" : "#fbbf24",
                      }}>{c.resultIcon}</span>
                      {" "}{c.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {curation.testPm?.stackingSepa?.length > 0 && (
          <div>
            <div style={{fontSize:11,fontWeight:700,color:"#7dd3fc",marginBottom:6}}>Stacking Sepa Run 문제</div>
            <ul style={{margin:0,paddingLeft:18,fontSize:10.5,color:"#cbd5e1",lineHeight:1.7}}>
              {curation.testPm.stackingSepa.map((s, i) => (
                <li key={i} style={{marginBottom:2}}>
                  <span style={{fontWeight:700,fontFamily:"monospace"}}>{s.date} {s.equipment}</span>
                  {": "}{s.issue}{" "}
                  <span style={{color:"#ef4444"}}>{s.resultIcon}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(!curation.testPm ||
          (!curation.testPm.linePM?.length &&
           !curation.testPm.fmvs?.length &&
           !curation.testPm.cutter?.length &&
           !curation.testPm.stackingSepa?.length)) && empty("테스트/PM 활동 없음")}

        {/* ★ 12-Y3: Line 3D Cutter CPC 모니터링 */}
        {curation.line3DCutterCpc && curation.line3DCutterCpc.status && (
          <div style={{
            marginTop:10, padding:"8px 12px",
            background:"rgba(34,211,238,0.06)",
            border:"1px solid rgba(34,211,238,0.25)",
            borderRadius:5,
          }}>
            <div style={{fontSize:11, fontWeight:700, color:"#22d3ee", marginBottom:4}}>
              📡 Line 3D Cutter CPC 이상 (모니터링)
            </div>
            <div style={{fontSize:10, color:"#cbd5e1", marginBottom:4}}>{curation.line3DCutterCpc.status}</div>
            {curation.line3DCutterCpc.details?.length > 0 && (
              <ul style={{margin:0, paddingLeft:16, fontSize:9.5, color:"#94a3b8", lineHeight:1.6}}>
                {curation.line3DCutterCpc.details.map((d, di) => <li key={di}>{d}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* ★ 12-Y3: Stacking 1-AB Sepa Run Issues (만성 라인) */}
        {curation.chronic1AB && (curation.chronic1AB.title || curation.chronic1AB.byEquipment?.length) && (
          <div style={{
            marginTop:10, padding:"10px 12px",
            background:"rgba(239,68,68,0.06)",
            border:"1px solid rgba(239,68,68,0.25)",
            borderLeft:"4px solid #ef4444",
            borderRadius:5,
          }}>
            <div style={{fontSize:11.5, fontWeight:800, color:"#fca5a5", marginBottom:4}}>
              🔥 {curation.chronic1AB.title || "Stacking 1-AB Sepa Run Issues (지속 모니터링)"}
            </div>
            {curation.chronic1AB.patternSummary && (
              <div style={{fontSize:10, color:"#cbd5e1", marginBottom:6, fontStyle:"italic"}}>
                → {curation.chronic1AB.patternSummary}
              </div>
            )}
            {curation.chronic1AB.byEquipment?.length > 0 && (
              <table style={{...tableStyle, fontSize:10}}>
                <thead><tr><th style={thStyle}>호기</th><th style={thStyle}>다발 NG</th></tr></thead>
                <tbody>
                  {curation.chronic1AB.byEquipment.map((e, ei) => (
                    <tr key={ei}>
                      <td style={{...tdStyle,fontWeight:700,fontFamily:"monospace"}}>{e.equipment}</td>
                      <td style={{...tdStyle,color:"#fca5a5"}}>{e.ngList}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* 5. NG 품질 실적 */}
      <div style={sectionStyle}>
        <div style={{...headingStyle,color:"#a78bfa"}}>📊 5. 일일 NG 품질 실적</div>

        {(!curation.qualityNg?.table || curation.qualityNg.table.length === 0) ? empty("NG 품질 데이터 없음") : (
          <>
            <table style={tableStyle}>
              <thead><tr>
                <th style={thStyle}>일자</th>
                <th style={{...thStyle,textAlign:"right"}}>Sepa Fold</th>
                <th style={{...thStyle,textAlign:"right"}}>Electrode Expose</th>
                <th style={{...thStyle,textAlign:"right"}}>Non Response</th>
                <th style={{...thStyle,textAlign:"right"}}>Dim Overkill</th>
                <th style={{...thStyle,textAlign:"right"}}>Contact NG</th>
              </tr></thead>
              <tbody>
                {curation.qualityNg.table.map((row, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{row.date}</td>
                    <td style={{...tdStyle,textAlign:"right",fontWeight:row.sepaFold>=20?700:400,color:row.sepaFold>=20?"#ef4444":"#cbd5e1"}}>{row.sepaFold ?? "-"}</td>
                    <td style={{...tdStyle,textAlign:"right"}}>{row.electrodeExpose ?? "-"}</td>
                    <td style={{...tdStyle,textAlign:"right"}}>{row.nonResponse ?? "-"}</td>
                    <td style={{...tdStyle,textAlign:"right"}}>{row.dimOverkill ?? "-"}</td>
                    <td style={{...tdStyle,textAlign:"right"}}>{row.contactNg ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {curation.qualityNg.trend && curation.qualityNg.trend !== "데이터 없음" && (
              <div style={{
                marginTop:10, padding:"10px 14px",
                background:"rgba(41,128,185,0.08)", border:"1px solid rgba(41,128,185,0.25)",
                borderLeft:"4px solid #2980b9", borderRadius:6,
                fontSize:10.5, color:"#cbd5e1", lineHeight:1.6,
              }}>
                <strong style={{color:"#60a5fa"}}>추세:</strong> {curation.qualityNg.trend}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── ★ 영역 11-F: STEP 4 메인 페이지 (사용자 레포트 1~7번 형태) ──────────────
// 1~5번: BriefingDisplay 재사용 (체크박스 props 미전달 = 정보 표시 전용)
// 6번: 가장 주목할 사항 (LLM 생성 인사이트)
// 7번: 액션 후속 사항 (P0/P1/P2 표)
function MainReportPage({ minutes }) {
  if (!minutes) return null;
  const sectionStyle = {
    background:"rgba(15,23,42,0.6)", border:"1px solid rgba(100,116,139,0.25)",
    borderRadius:10, padding:"14px 16px", marginBottom:14,
  };
  const headingStyle = {
    fontSize:13, fontWeight:800, marginBottom:10,
    paddingBottom:6, borderBottom:"1px solid rgba(51,65,85,0.4)",
  };
  const tableStyle = { width:"100%", fontSize:10.5, color:"#cbd5e1", borderCollapse:"collapse" };
  const thStyle = {
    padding:"5px 8px", background:"rgba(51,65,85,0.4)",
    color:"#94a3b8", fontWeight:700, textAlign:"left",
    border:"1px solid rgba(51,65,85,0.4)",
  };
  const tdStyle = { padding:"5px 8px", border:"1px solid rgba(51,65,85,0.3)", verticalAlign:"top" };

  // 분석 기간 라벨
  const periodLabel = (() => {
    if (minutes.range && minutes.range.start && minutes.range.end) {
      // selRange 활용 — buildRangeLabel 결과는 minutes.date에 이미 들어있을 가능성
      return minutes.date;
    }
    return minutes.date || "";
  })();

  // 6번 confidence 라벨 색상
  const confColor = (conf) => conf?.includes("가설") ? "#f59e0b" : "#34d399";
  const confLabel = (conf) => conf?.includes("가설") ? "🔬 가설 — 검증필요" : "✅ 확실";

  // 7번 P0/P1/P2 색상
  const pColor = (p) => p === "P0" ? "#c0392b" : p === "P1" ? "#e67e22" : "#d4ac0d";
  const pIcon = (p) => p === "P0" ? "🚨" : p === "P1" ? "🔴" : "🟡";

  return (
    <div>
      {/* 헤더 */}
      <div style={{
        background:"rgba(29,78,216,0.08)", borderTop:"4px solid #1d4ed8",
        borderRadius:"0 0 10px 10px",
        padding:"18px 20px", marginBottom:16,
      }}>
        <div style={{fontSize:18,fontWeight:900,color:"#dbeafe",marginBottom:6}}>
          AZS Factory 일일 이슈 레포트
        </div>
        <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.7}}>
          <strong>분석 기간:</strong> {periodLabel}<br/>
          <strong>출처:</strong> AZS Status Reports WhatsApp 그룹<br/>
          <strong>레코드:</strong> {(() => {
            const rb = minutes.curation?.recordBreakdown || {};
            const parts = [];
            if (rb.bmDowntime > 0) parts.push(`BM Downtime Bot ${rb.bmDowntime}건`);
            if (rb.ubm > 0) parts.push(`UBM ${rb.ubm}건`);
            if (rb.pdDowntime > 0) parts.push(`PD Downtime ${rb.pdDowntime}건`);
            if (rb.other > 0) parts.push(`기타 ${rb.other}건`);
            return parts.length > 0 ? parts.join(" + ") : `부동 이슈 ${(minutes.tagged?.issues || []).length}건`;
          })()}
          {minutes.curation?.summary_text && (
            <>
              <br/>
              <strong>요약:</strong> {minutes.curation.summary_text}
            </>
          )}
        </div>
      </div>

      {/* 1~5번: BriefingDisplay (정보 표시 전용 — 체크박스 props 미전달) */}
      <BriefingDisplay
        curation={minutes.curation}
        allIssues={minutes.tagged?.issues || []}
        discussions={minutes.discussions || []}
      />

      {/* 6번: 가장 주목할 사항 */}
      <div style={sectionStyle}>
        <div style={{...headingStyle,color:"#e67e22"}}>⚠️ 6. 가장 주목할 사항</div>
        {(!minutes.insights || minutes.insights.length === 0) ? (
          <div style={{fontSize:10,color:"#64748b",padding:"8px 0"}}>인사이트 없음</div>
        ) : (
          <div>
            {minutes.insights.map((ins, idx) => (
              <div key={idx} style={{
                padding:"10px 14px", marginBottom:8,
                background:"rgba(15,23,42,0.4)", border:"1px solid rgba(51,65,85,0.3)",
                borderLeft:`4px solid ${confColor(ins.confidence)}`,
                borderRadius:6,
              }}>
                <div style={{
                  display:"flex", alignItems:"center", gap:10,
                  marginBottom:6,
                }}>
                  <span style={{fontSize:11,fontWeight:800,color:"#fcd34d",flex:1}}>
                    {ins.title}
                  </span>
                  <span style={{
                    fontSize:9, padding:"2px 8px", borderRadius:10,
                    background:`${confColor(ins.confidence)}22`,
                    color:confColor(ins.confidence),
                    fontWeight:700,
                  }}>{confLabel(ins.confidence)}</span>
                </div>
                {ins.bulletPoints?.length > 0 && (
                  <ul style={{margin:0,paddingLeft:18,fontSize:10.5,color:"#cbd5e1",lineHeight:1.6}}>
                    {ins.bulletPoints.map((bp, bi) => (
                      <li key={bi} style={{marginBottom:2}}>{bp}</li>
                    ))}
                  </ul>
                )}
                {ins.evidence && (
                  <div style={{
                    fontSize:9, color:"#64748b", marginTop:6, paddingTop:4,
                    borderTop:"1px dashed rgba(100,116,139,0.3)",
                  }}>
                    📎 근거: <span style={{color:"#94a3b8"}}>{ins.evidence}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 7번: 액션 후속 사항 */}
      <div style={sectionStyle}>
        <div style={{...headingStyle,color:"#a78bfa"}}>📌 7. 액션 후속 사항</div>
        {(!minutes.actions || minutes.actions.length === 0) ? (
          <div style={{fontSize:10,color:"#64748b",padding:"8px 0"}}>액션 항목 없음</div>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={{...thStyle,width:"10%",textAlign:"center"}}>우선순위</th>
                <th style={thStyle}>항목</th>
                <th style={thStyle}>비고</th>
                <th style={{...thStyle,width:"18%"}}>근거</th>
              </tr>
            </thead>
            <tbody>
              {minutes.actions.map((a, idx) => (
                <tr key={idx}>
                  <td style={{...tdStyle,textAlign:"center"}}>
                    <span style={{
                      fontSize:10, fontWeight:800, color:pColor(a.priority),
                    }}>{pIcon(a.priority)} {a.priority}</span>
                  </td>
                  <td style={tdStyle}>
                    <strong>{a.action}</strong>
                    {a._ruleAdjusted && (
                      <div style={{fontSize:8,color:"#94a3b8",marginTop:2}}>
                        ※ {a._ruleAdjusted}
                      </div>
                    )}
                  </td>
                  <td style={{...tdStyle,fontSize:10}}>
                    {a.context}
                    {a.confidence?.includes("가설") && (
                      <span style={{
                        marginLeft:6, fontSize:8, padding:"1px 5px", borderRadius:3,
                        background:"rgba(245,158,11,0.15)", color:"#fbbf24", fontWeight:700,
                      }}>🔬 검증필요</span>
                    )}
                  </td>
                  <td style={{...tdStyle,fontSize:9,color:"#94a3b8"}}>{a.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 푸터 */}
      <div style={{
        textAlign:"center", fontSize:9, color:"#64748b", marginTop:20,
        paddingTop:12, borderTop:"1px solid rgba(51,65,85,0.3)",
      }}>
        — 메인 레포트 종료 —<br/>
        AZS Status Reports WhatsApp 데이터 기반
      </div>
    </div>
  );
}

// ─── ★ 영역 12 Phase 2: 페르소나 대화형 표시 컴포넌트 ──────────────────────────
// 좌우 번갈아 정렬 + 말풍선 (페르소나 색상 배경) + 사회자 종합
// props:
//   discussion: { issue, modeInfo, opinions, moderator } — runIssueDiscussion 결과
//   defaultExpanded: boolean (기본 false = 접힘)
function PersonaConversation({ discussion, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!discussion) return null;
  const { opinions = [], moderator = {}, modeInfo } = discussion;

  // 입장 → 색상
  const stanceStyle = {
    "동의": { bg: "rgba(52,211,153,0.2)", color: "#34d399" },
    "부분동의": { bg: "rgba(251,191,36,0.2)", color: "#fbbf24" },
    "반대": { bg: "rgba(239,68,68,0.2)", color: "#ef4444" },
    "추가의견": { bg: "rgba(167,139,250,0.2)", color: "#a78bfa" },
    "초기분석": { bg: "rgba(96,165,250,0.2)", color: "#60a5fa" },
  };
  const sStyle = (s) => stanceStyle[s] || { bg: "rgba(100,116,139,0.2)", color: "#94a3b8" };

  return (
    <div style={{
      marginTop: 12, paddingTop: 12,
      borderTop: "1px dashed rgba(100,116,139,0.5)",
    }}>
      {/* 헤더 (토글) */}
      <div onClick={() => setExpanded(!expanded)} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        cursor: "pointer", padding: "6px 10px",
        background: "rgba(167,139,250,0.1)",
        border: "1px solid rgba(167,139,250,0.3)",
        borderRadius: 6, fontSize: 11, fontWeight: 700, color: "#a78bfa",
      }}>
        <span>💬 페르소나 논의 ({opinions.length}명 발언) · {modeInfo?.mode || "?"} 모드 · 사회자 종합 포함</span>
        <span>{expanded ? "▼ 접기" : "▶ 펼치기"}</span>
      </div>

      {expanded && (
        <>
          {/* 메시지 리스트 (좌우 번갈아) */}
          <div style={{ padding: "14px 4px" }}>
            {opinions.map((o, idx) => {
              const p = PERSONAS[o.persona] || {};
              const op = o.opinion || {};
              const isLeft = idx % 2 === 0;
              const stance = op.stance || "초기분석";
              const sty = sStyle(stance);
              const sayText = op.say || op.근본원인 || "(발언 데이터 없음)";
              const quote = op.quote || op.previous_reference || "";
              const replyTo = op.reply_to || "";

              return (
                <div key={idx} style={{
                  display: "flex",
                  flexDirection: isLeft ? "row" : "row-reverse",
                  marginBottom: 14, gap: 8,
                  animation: "fadeUp 0.3s",
                }}>
                  {/* 아바타 */}
                  <div style={{
                    flexShrink: 0, width: 38, height: 38,
                    borderRadius: "50%", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    fontSize: 18, fontWeight: 700,
                    background: p.bg || "rgba(100,116,139,0.25)",
                    color: p.color || "#94a3b8",
                  }}>
                    {p.icon || "?"}
                  </div>

                  {/* 메시지 영역 */}
                  <div style={{ maxWidth: "70%", textAlign: isLeft ? "left" : "right" }}>
                    {/* 이름 + 입장 + 답변 대상 */}
                    <div style={{
                      fontSize: 9.5, fontWeight: 700, marginBottom: 4,
                      display: "flex", gap: 6, alignItems: "center",
                      justifyContent: isLeft ? "flex-start" : "flex-end",
                      color: p.color || "#94a3b8",
                    }}>
                      {!isLeft && replyTo && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 8,
                          background: "rgba(100,116,139,0.2)", color: "#94a3b8", fontWeight: 600,
                        }}>↩ {replyTo}</span>
                      )}
                      {!isLeft && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 8,
                          background: sty.bg, color: sty.color, fontWeight: 700,
                        }}>{stance}</span>
                      )}
                      <span>{p.label || o.persona}</span>
                      {isLeft && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 8,
                          background: sty.bg, color: sty.color, fontWeight: 700,
                        }}>{stance}</span>
                      )}
                      {isLeft && replyTo && (
                        <span style={{
                          fontSize: 9, padding: "1px 6px", borderRadius: 8,
                          background: "rgba(100,116,139,0.2)", color: "#94a3b8", fontWeight: 600,
                        }}>↩ {replyTo}</span>
                      )}
                    </div>

                    {/* 말풍선 (페르소나 색상 배경) */}
                    <div style={{
                      padding: "10px 14px",
                      borderRadius: 14,
                      borderTopLeftRadius: isLeft ? 4 : 14,
                      borderTopRightRadius: isLeft ? 14 : 4,
                      fontSize: 11, lineHeight: 1.6, wordWrap: "break-word",
                      background: p.color || "#475569",
                      color: "#fff",
                      textAlign: "left",
                    }}>
                      {/* 인용구 */}
                      {quote && (
                        <div style={{
                          fontSize: 10, fontStyle: "italic",
                          padding: "4px 10px", marginBottom: 6,
                          borderLeft: "3px solid rgba(0,0,0,0.3)",
                          background: "rgba(0,0,0,0.18)",
                          borderRadius: "0 8px 8px 0",
                          color: "rgba(255,255,255,0.85)",
                        }}>
                          "{quote}"
                        </div>
                      )}
                      {/* 발언 본문 */}
                      <div>{sayText}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 사회자 종합 (대화 끝, 옵션 ¬) */}
          <div style={{
            marginTop: 12, padding: "12px 16px",
            background: "rgba(167,139,250,0.08)",
            border: "1px solid rgba(167,139,250,0.3)",
            borderLeft: "5px solid #a78bfa",
            borderRadius: 8, fontSize: 11, color: "#e2e8f0", lineHeight: 1.6,
          }}>
            <div style={{ color: "#c4b5fd", fontWeight: 700, marginBottom: 8 }}>
              📋 사회자 종합 ({modeInfo?.mode || "?"})
            </div>

            {moderator["근본원인_합의"] && (
              <div style={{ margin: "5px 0" }}>
                <b style={{ color: "#fca5a5", display: "inline-block", minWidth: 130 }}>🎯 근본원인 합의:</b>
                {moderator["근본원인_합의"]}
              </div>
            )}
            {moderator["조치안_평가_합의"] && (
              <div style={{ margin: "5px 0" }}>
                <b style={{ color: "#fdba74", display: "inline-block", minWidth: 130 }}>⚖️ 조치안 평가:</b>
                {moderator["조치안_평가_합의"]}
              </div>
            )}
            {moderator["개선안_합의"] && (
              <div style={{ margin: "5px 0" }}>
                <b style={{ color: "#93c5fd", display: "inline-block", minWidth: 130 }}>💡 개선안 합의:</b>
                {moderator["개선안_합의"]}
              </div>
            )}
            {moderator["재발방지책_합의"] && (
              <div style={{ margin: "5px 0" }}>
                <b style={{ color: "#86efac", display: "inline-block", minWidth: 130 }}>🛡️ 재발방지책:</b>
                {moderator["재발방지책_합의"]}
              </div>
            )}
            {moderator["충돌점"] && moderator["충돌점"] !== "없음" && (
              <div style={{ margin: "5px 0" }}>
                <b style={{ color: "#ef4444", display: "inline-block", minWidth: 130 }}>⚠️ 충돌점:</b>
                {moderator["충돌점"]}
              </div>
            )}
            {moderator["추가_논의_필요"] && moderator["추가_논의_필요"] !== "없음" && (
              <div style={{ margin: "5px 0" }}>
                <b style={{ color: "#fbbf24", display: "inline-block", minWidth: 130 }}>🔍 추가 논의:</b>
                {moderator["추가_논의_필요"]}
              </div>
            )}

            {/* STANDARD 모드 actions */}
            {Array.isArray(moderator.actions) && moderator.actions.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <b style={{ color: "#93c5fd" }}>📋 액션 플랜:</b>
                <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
                  {moderator.actions.map((a, ai) => (
                    <li key={ai} style={{ marginBottom: 2 }}>
                      <b>[{a.priority}]</b> {a.action}
                      <span style={{ color: "#94a3b8", fontSize: 10 }}> (담당:{a.owner}, {a.duration}{a.type ? `, ${a.type}` : ""})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* LITE 모드 */}
            {moderator.supplement && (
              <div style={{ margin: "5px 0" }}>✅ 보완: {moderator.supplement}</div>
            )}
            {moderator.recurRisk && (
              <div style={{ margin: "5px 0" }}>🔁 재발우려: {moderator.recurRisk}</div>
            )}
            {moderator.prevention && (
              <div style={{ margin: "5px 0" }}>🛡️ 방지책: {moderator.prevention}</div>
            )}

            {/* 한 줄 요약 */}
            {moderator.consensus && (
              <div style={{
                marginTop: 10, paddingTop: 8,
                borderTop: "1px solid rgba(167,139,250,0.2)",
                fontStyle: "italic", color: "#c4b5fd",
              }}>
                💬 {moderator.consensus.slice(0, 200)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DiscussionCard({ discussion }) {
  const [expanded, setExpanded] = useState(false);  // 영역 12-C: 카드 전체 접힘 (기본 접힘)
  const [showOpinions, setShowOpinions] = useState(false);
  const [showDetailCard, setShowDetailCard] = useState(false);
  const { issue, modeInfo, isPostAction, router, opinions, moderator } = discussion;
  const mStyle = MODE_STYLE[modeInfo.mode];
  const fallbackLevel = moderator?._fallback_level || "primary";
  const detailCard = buildIssueDetailCard(discussion);

  // 폴백 배지
  const fbBadge = fallbackLevel === "primary" ? null
    : fallbackLevel === "retry" ? { label: "🔁 재시도 성공", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" }
    : { label: "⚠️ 코드 폴백", color: "#ef4444", bg: "rgba(239,68,68,0.15)" };

  // 사회자 종합 한 줄 미리보기 (헤더용)
  const consensusPreview = (
    moderator?.["근본원인_합의"] ||
    moderator?.consensus ||
    moderator?.summary ||
    moderator?.supplement ||
    "사회자 합의 미수립"
  ).slice(0, 80);

  return (
    <div style={{
      background:"rgba(15,23,42,0.7)",
      border:`1px solid ${mStyle.border}`,
      borderRadius:10, padding:"14px 16px", marginBottom:8,
    }}>
      {/* 헤더 — 영역 12-C: 클릭으로 카드 전체 토글 */}
      <div onClick={() => setExpanded(!expanded)} style={{
        display:"flex",justifyContent:"space-between",alignItems:"flex-start",
        gap:8, flexWrap:"wrap", cursor:"pointer",
        marginBottom: expanded ? 8 : 0,
      }}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,fontWeight:800,color:mStyle.color,display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,color:mStyle.color}}>{expanded ? "▼" : "▶"}</span>
            [{issue.time}] {issue.eq}
            {isPostAction && (
              <span style={{
                fontSize:9, padding:"1px 6px",
                background:"rgba(52,211,153,0.15)", color:"#34d399",
                borderRadius:8, fontWeight:700,
              }}>✓ 기조치</span>
            )}
          </div>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>
            {issue.durMin}분 · {issue.prob}
          </div>
          {/* 접힌 상태일 때 사회자 합의 미리보기 */}
          {!expanded && (
            <div style={{fontSize:10,color:"#cbd5e1",marginTop:4,fontStyle:"italic",paddingLeft:14}}>
              {consensusPreview}
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
          {fbBadge && (
            <span style={{
              fontSize:9, padding:"2px 6px",
              background:fbBadge.bg, color:fbBadge.color,
              borderRadius:8, fontWeight:700,
            }}>{fbBadge.label}</span>
          )}
          <span style={{fontSize:9,color:mStyle.color}}>{modeInfo.source}</span>
        </div>
      </div>

      {/* 본문 — expanded 시에만 표시 */}
      {expanded && (
      <>
      {/* 분류 사유 */}
      <div style={{
        fontSize:10, color:"#cbd5e1", padding:"6px 10px",
        background:"rgba(0,0,0,0.2)", borderRadius:5, marginBottom:8,
      }}>
        📌 {modeInfo.reason}
        {router && <span style={{color:"#94a3b8"}}> | 발언순서: {router.order.map(o => PERSONAS[o]?.icon).join(" → ")}</span>}
      </div>

      {/* 사회자 종합 (메인) — 영역 12-C: 새 4축 필드 */}
      <div style={{
        padding:"10px 12px", background:mStyle.bg, borderRadius:6,
        fontSize:11, color:"#e2e8f0", lineHeight:1.7,
      }}>
        {moderator.type === "deep" && (
          <>
            {/* 영역 12: 새 4축 합의 표시 (있으면 우선) */}
            {moderator["근본원인_합의"] ? (
              <>
                <div><b style={{color:"#fca5a5"}}>🎯 근본원인:</b> {moderator["근본원인_합의"]}</div>
                {moderator["조치안_평가_합의"] && (
                  <div style={{marginTop:4}}><b style={{color:"#fdba74"}}>⚖️ 조치안 평가:</b> {moderator["조치안_평가_합의"]}</div>
                )}
                {moderator["개선안_합의"] && (
                  <div style={{marginTop:4}}><b style={{color:"#93c5fd"}}>💡 개선안:</b> {moderator["개선안_합의"]}</div>
                )}
                {moderator["재발방지책_합의"] && (
                  <div style={{marginTop:4}}><b style={{color:"#86efac"}}>🛡️ 재발방지책:</b> {moderator["재발방지책_합의"]}</div>
                )}
                {moderator["충돌점"] && moderator["충돌점"] !== "없음" && (
                  <div style={{marginTop:4}}><b style={{color:"#ef4444"}}>⚠️ 충돌점:</b> {moderator["충돌점"]}</div>
                )}
                {moderator["추가_논의_필요"] && moderator["추가_논의_필요"] !== "없음" && (
                  <div style={{marginTop:4}}><b style={{color:"#fbbf24"}}>🔍 추가 논의:</b> {moderator["추가_논의_필요"]}</div>
                )}
                {moderator.consensus && (
                  <div style={{marginTop:6, fontStyle:"italic", color:"#94a3b8", fontSize:10}}>
                    {moderator.consensus}
                  </div>
                )}
              </>
            ) : (
              // 옛 필드 호환 (consensus/differences/conflicts/recommendation)
              <>
                <div><b style={{color:mStyle.color}}>【합의】</b> {moderator.consensus}</div>
                {moderator.differences && <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【차이】</b> {moderator.differences}</div>}
                {moderator.conflicts && <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【충돌】</b> {moderator.conflicts}</div>}
                {moderator.recommendation && <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【권고】</b> {moderator.recommendation}</div>}
                {moderator.needsMore && moderator.needsMore !== "없음" && (
                  <div style={{marginTop:4}}><b style={{color:mStyle.color}}>【추가논의】</b> {moderator.needsMore}</div>
                )}
              </>
            )}
          </>
        )}
        {moderator.type === "standard" && (
          <>
            {moderator["근본원인_합의"] && (
              <div><b style={{color:"#fca5a5"}}>🎯 근본원인:</b> {moderator["근본원인_합의"]}</div>
            )}
            {moderator["조치안_평가_합의"] && (
              <div style={{marginTop:4}}><b style={{color:"#fdba74"}}>⚖️ 조치안 평가:</b> {moderator["조치안_평가_합의"]}</div>
            )}
            {moderator.summary && (
              <div style={{marginTop:moderator["근본원인_합의"] ? 6 : 0}}><b style={{color:mStyle.color}}>요약:</b> {moderator.summary}</div>
            )}
            {(moderator.actions || []).map((a, ai) => (
              <div key={ai} style={{marginTop:4,paddingLeft:8}}>
                ▸ <b style={{color:mStyle.color}}>[{a.priority}]</b> {a.action}
                <span style={{color:"#94a3b8",fontSize:10}}> (담당:{a.owner}, {a.duration}{a.type ? `, ${a.type}` : ""})</span>
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

      {/* ★ 상세 카드 펼치기 (모드별 차등) */}
      <button onClick={()=>setShowDetailCard(!showDetailCard)} style={{
        marginTop:8, marginRight:6, padding:"4px 10px", fontSize:10,
        background:"rgba(167,139,250,0.1)", border:"1px solid rgba(167,139,250,0.4)",
        borderRadius:4, color:"#a78bfa", cursor:"pointer", fontWeight:700,
      }}>
        {showDetailCard ? "▲ 상세 카드 접기" : `▼ 상세 카드 (${detailCard.mode === "DEEP" ? "8필드" : "3필드"})`}
      </button>

      {showDetailCard && (
        <div style={{
          marginTop:8, padding:"12px 14px",
          background:"rgba(167,139,250,0.06)",
          border:"1px solid rgba(167,139,250,0.2)",
          borderRadius:6, fontSize:11, color:"#e2e8f0", lineHeight:1.7,
        }}>
          <div style={{fontSize:10,color:"#a78bfa",fontWeight:800,marginBottom:8}}>
            📋 이슈 상세 분석 카드
          </div>

          <DetailRow label="현상" value={detailCard["현상"]} />
          <DetailRow label="원인" value={detailCard["원인"]} />

          {detailCard.mode === "DEEP" ? (
            <>
              <DetailRow label="즉시 조치" value={detailCard["즉시조치"]} />
              <DetailRow
                label="기존 조치 적절성"
                value={detailCard["기존조치_적절성"]}
                highlight={isPostAction}
              />
              <DetailRow label="재발 방지책" value={detailCard["재발방지책"]} />
              <DetailRow label="보완책" value={detailCard["보완책"]} />

              {/* 발언자별 의견 */}
              <div style={{marginTop:8}}>
                <div style={{fontSize:10,color:"#a78bfa",fontWeight:700,marginBottom:5}}>발언자별 의견</div>
                {detailCard["발언자별의견"].map((v, vi) => (
                  <div key={vi} style={{
                    fontSize:10, padding:"5px 8px", marginBottom:3,
                    background:"rgba(0,0,0,0.2)", borderRadius:4,
                  }}>
                    <span style={{color:PERSONAS[v.code]?.color,fontWeight:700}}>{v.icon} {v.label}</span>
                    <span style={{color:"#94a3b8",fontSize:9,marginLeft:6}}>[{v.stance}]</span>
                    <div style={{color:"#cbd5e1",marginTop:2}}>{v.summary}</div>
                  </div>
                ))}
              </div>

              <DetailRow label="합의/반대 지점" value={detailCard["합의반대지점"]} />
            </>
          ) : (
            <DetailRow label="대책" value={detailCard["대책"]} />
          )}
        </div>
      )}

      {/* 페르소나 의견 펼치기 (대화체 + 새 6필드) */}
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
                const op = o.opinion || {};
                return (
                  <div key={i} style={{
                    background:p.bg, padding:"8px 10px", borderRadius:6, marginBottom:5,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <div style={{fontSize:10,color:p.color,fontWeight:800}}>
                        {p.icon} {p.label} ({o.persona})
                      </div>
                      {op.stance && (
                        <span style={{
                          fontSize:9,padding:"1px 6px",
                          background:"rgba(0,0,0,0.3)",color:"#cbd5e1",
                          borderRadius:8,
                        }}>{op.stance}</span>
                      )}
                    </div>
                    {/* 이전 발언 인용 (대화체 표시) */}
                    {op.previous_reference && op.previous_reference !== "" && (
                      <div style={{
                        fontSize:9,color:"#94a3b8",fontStyle:"italic",
                        padding:"4px 8px",background:"rgba(0,0,0,0.25)",
                        borderLeft:`2px solid ${p.color}`,marginBottom:5,borderRadius:3,
                      }}>
                        💬 {op.previous_reference}
                      </div>
                    )}
                    {/* 6필드 출력 */}
                    <div style={{fontSize:10,color:"#cbd5e1",lineHeight:1.6}}>
                      📌 <b>현상:</b> {op["현상"] || "-"}<br/>
                      🔍 <b>원인:</b> {op["원인"] || "-"}<br/>
                      ⚡ <b>대책:</b> {op["대책"] || "-"}<br/>
                      {op["기존조치_평가"] && op["기존조치_평가"] !== "해당없음" && op["기존조치_평가"] !== "-" && (
                        <>🔁 <b>기조치 평가:</b> {op["기존조치_평가"]}</>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      </>
      )}

    </div>
  );
}

// 상세 카드 한 행
function DetailRow({ label, value, highlight }) {
  return (
    <div style={{
      marginBottom:6, paddingBottom:6,
      borderBottom:"1px solid rgba(51,65,85,0.3)",
    }}>
      <span style={{
        fontSize:9, fontWeight:800,
        color: highlight ? "#34d399" : "#a78bfa",
        marginRight:6,
      }}>
        {highlight && "★ "}{label}
      </span>
      <span style={{fontSize:10,color:"#cbd5e1"}}>{value || "-"}</span>
    </div>
  );
}
