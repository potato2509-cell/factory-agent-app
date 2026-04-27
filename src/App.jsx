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

// ─── 영역 5: 큐레이션 이력 카테고리 키워드 (1차 안, 사용 후 튜닝) ─────────────────
// 부동 이슈와 별개로 WhatsApp 일반 메시지에서 추출하여 큐레이션 이력으로만 정리
const QUALITY_KEYWORDS = [
  "불량", "defect", "NG", "수율", "yield", "Cpk",
  "코팅 불량", "두께", "정렬", "외관", "치수",
  "SAR", "NCR", "HOLD", "스크랩", "scrap", "리젝",
];

const PROCESS_CHANGE_KEYWORDS = [
  "변경", "조정", "change", "set", "setpoint",
  "recipe", "셋업", "조건", "오프셋", "offset",
  "Gap", "압력", "온도", "속도", "tuning", "튜닝",
  "파라미터", "parameter",
];

const TEST_KEYWORDS = [
  "테스트", "test", "시험", "검증", "validation",
  "trial", "trial run", "샘플", "sample", "DOE",
  "양산외", "비정상 생산", "특별 생산", "엔지니어링 런",
  "engineering run", "pilot",
];

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
  // 영역 5: 큐레이션 이력 카테고리
  const qualityMsgs = [], processChangeMsgs = [], testMsgs = [], ambiguousMsgs = [];
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

    // ── 영역 5: 다운타임이 아닌 메시지에 대해 큐레이션 카테고리 키워드 매칭 ──
    // (다운타임 메시지는 j까지 점프했으므로 위에서 분류되고 여기는 돌아오지 않음)
    if (m.text.includes("[BM Downtime Bot]")) continue;
    if (m.text.trim().length <= 5) continue;
    if (m.text.includes("미디어 파일 제외됨")) continue;

    const lowerText = m.text.toLowerCase();
    const matched = [];
    if (QUALITY_KEYWORDS.some(kw => lowerText.includes(kw.toLowerCase()))) matched.push("quality");
    if (PROCESS_CHANGE_KEYWORDS.some(kw => lowerText.includes(kw.toLowerCase()))) matched.push("process_change");
    if (TEST_KEYWORDS.some(kw => lowerText.includes(kw.toLowerCase()))) matched.push("test");

    const entry = { time: m.time, sender: m.sender, text: m.text, date: m.date, hour: m.hour };

    if (matched.length === 1) {
      // 1개 카테고리만 매칭 → 직접 할당
      if (matched[0] === "quality") qualityMsgs.push(entry);
      else if (matched[0] === "process_change") processChangeMsgs.push(entry);
      else if (matched[0] === "test") testMsgs.push(entry);
    } else if (matched.length >= 2) {
      // 2개 이상 카테고리에 걸침 → 모호 (AI 분류 대상, 5-C에서 처리)
      ambiguousMsgs.push({ ...entry, matched });
    }
    // matched.length === 0 → general에만 남고 카테고리 미할당 (AI 비용 절약)
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
    // 영역 5: 점수 계산용 반복 횟수 (호기 또는 부품 중 큰 값)
    const repeatCount = Math.max(
      eq_ ? (equipCount[eq_] || 1) : 1,
      (part && part !== "-" && part.length > 2) ? (partCount[part] || 1) : 1,
    );
    const issueInfo = { ...d, eq: eq_, prob, cause, result: result_, pic, durMin, reasons: [], repeatCount };

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

// ─── 영역 5-D: 이슈 점수 계산 ────────────────────────────────────────────────
// 점수 = 부동(분)/30 + 반복횟수×3 + 안전환경(+10) + 미해결(+5) + FullStop(+5)
function scoreIssue(issue) {
  const breakdown = {
    downtime: (issue.durMin || 0) / 30,
    repeat: ((issue.repeatCount || 1) >= 2) ? (issue.repeatCount * 3) : 0,
    safety_env: 0,
    unsolved: 0,
    full_stop: 0,
  };

  // 안전/환경 키워드 보너스 (+10)
  const fullText = [issue.eq, issue.prob, issue.cause, issue.result, issue.text || ""]
    .join(" ").toLowerCase();
  const safetyEnvKw = [...DEEP_FORCE_KEYWORDS.안전, ...DEEP_FORCE_KEYWORDS.환경];
  if (safetyEnvKw.some(kw => fullText.includes(kw.toLowerCase()))) {
    breakdown.safety_env = 10;
  }

  // 미해결 보너스 (+5)
  if (issue.reasons?.some(r => r.includes("미해결"))) breakdown.unsolved = 5;

  // Full Stop 보너스 (+5)
  if (issue.reasons?.some(r => r.includes("완전 정지"))) breakdown.full_stop = 5;

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total: Math.round(total * 10) / 10, breakdown };
}

function selectKeyIssues(priority) {
  // urgent(장기부동/미해결) + important(반복/FullStop/부품반복) 모두 후보
  const candidates = [...priority.urgent, ...priority.important];

  // 점수 계산 후 score 필드 부착
  const scored = candidates.map(issue => {
    const s = scoreIssue(issue);
    return { ...issue, score: s.total, scoreBreakdown: s.breakdown };
  });

  // 점수 내림차순, 동률 시 부동시간 내림차순
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.durMin || 0) - (a.durMin || 0);
  });

  return scored.slice(0, MAX_ISSUES);
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ 새로운 논의 시스템 ★
// ═════════════════════════════════════════════════════════════════════════════

// ─── 0. PE 사전 큐레이션 (전체 이슈 1회 호출) ────────────────────────────────
async function runPreCuration(allIssues, kbPE, reportType, categoryMsgs = {}) {
  // 모든 이슈를 한 번에 PE에게 보내서 일자별 표 + 장기부동 + 반복항목 정리
  // 호출 1회로 전체 그림 작성 (토큰 비용 효율적)
  // 영역 5: categoryMsgs = { quality: [...], process_change: [...], test: [...] }

  const qualityList = categoryMsgs.quality || [];
  const processChangeList = categoryMsgs.process_change || [];
  const testList = categoryMsgs.test || [];

  if (!allIssues || allIssues.length === 0) {
    return {
      summary_text: "분석 대상 이슈 없음",
      daily_table: [],
      long_downtime: [],
      recurring: [],
      quality_issues: [],
      process_changes: [],
      tests_inspections: [],
    };
  }

  // 이슈 데이터를 JSON으로 변환 (PE가 읽기 쉽게)
  const issuesData = allIssues.map((issue, idx) => ({
    no: idx + 1,
    date: issue.date || "",
    time: issue.time,
    equipment: issue.eq,
    problem: issue.prob,
    cause: issue.cause,
    result: issue.result,
    pic: issue.pic,
    duration_min: issue.durMin,
    reasons: issue.reasons,
  }));

  // 영역 5: 카테고리 메시지를 PE 입력용으로 변환 (각 최대 20건)
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

  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장의 ${PERSONAS.Cell_PE.role.replace(" - Cell 공정", "")}입니다.
이번 작업은 단일 이슈 분석이 아니라, 주어진 모든 이슈를 한눈에 보고 큐레이션 정리하는 역할입니다.${kbText}

${focus} 다음 이슈 데이터 전체를 검토하여 보고서 첫머리에 들어갈 큐레이션을 작성하세요.

[필수 출력 - JSON만, 다른 텍스트 금지]
{
  "summary_text": "전체 이슈 흐름의 핵심 트렌드 요약 (예: '주요 트러블은 Stacking 공정에 집중', 200자 이내)",
  "daily_table": [
    {"date":"발생일자","equipment":"발생호기","issue":"주요내용 (50자)","action":"조치사항 (50자)","downtime":부동시간_분단위_숫자}
  ],
  "long_downtime": [
    {"equipment":"호기","reason":"장기 부동 사유","since":"시작일자","status":"현재상태 (진행형/완료/대기)","duration_note":"누적 시간 또는 기간 메모"}
  ],
  "recurring": [
    {"item":"반복 항목명 (예: Align Table Ejector Time Out)","lines":["발생 호기 배열"],"count":발생_횟수,"cause":"주요 원인"}
  ],
  "quality_issues": [
    {"date":"발생일자","time":"시간","item":"품질 이슈 내용 요약 (50자)","note":"비고 (담당자/처리상태 등)"}
  ],
  "process_changes": [
    {"date":"발생일자","time":"시간","item":"변경 내용 요약 (50자)","who":"담당자 또는 작업자"}
  ],
  "tests_inspections": [
    {"date":"발생일자","time":"시간","item":"테스트/시험 내용 요약 (50자)","purpose":"목적 또는 결과"}
  ]
}

[규칙]
- daily_table은 모든 이슈가 아니라 주요 이슈만 (각 일자 대표 이슈, 최대 10건)
- long_downtime은 60분 이상 또는 미해결 이슈
- recurring은 같은 항목이 2회 이상 발생한 것 (Equipment 또는 Problem 기준)
- quality_issues / process_changes / tests_inspections는 [품질 메시지], [공정변경 메시지], [테스트 메시지] 섹션 참고하여 정리 (각 최대 15건)
  · 입력 메시지가 없으면 빈 배열 []
  · 명백한 잡담이나 분류 오류로 보이면 제외
- 부동시간(downtime)은 반드시 숫자만 (단위 제외)
- 이슈 데이터의 PIC, 사유 등은 무시하고 객관적 사실만 정리`;

  const userMsg = `[전체 부동 이슈 데이터 - ${allIssues.length}건]
${JSON.stringify(issuesData, null, 1)}

[품질 이슈 메시지 - ${qualityData.length}건]
${qualityData.length > 0 ? JSON.stringify(qualityData, null, 1) : "(없음)"}

[공정/설비 조건변경 메시지 - ${processChangeData.length}건]
${processChangeData.length > 0 ? JSON.stringify(processChangeData, null, 1) : "(없음)"}

[테스트/양산외 생산 메시지 - ${testData.length}건]
${testData.length > 0 ? JSON.stringify(testData, null, 1) : "(없음)"}

위 모든 데이터를 검토하여 큐레이션 JSON을 작성하세요.`;

  try {
    await new Promise(r => setTimeout(r, 500));
    const raw = await callClaudeRaw(sys, userMsg, {
      model: MODEL_REASONING,
      max_tokens: 2500,  // 영역 5: 3개 카테고리 추가로 출력 늘어남
    });
    const parsed = safeJSON(raw);
    return {
      summary_text: parsed.summary_text || "큐레이션 요약 생성 실패",
      daily_table: Array.isArray(parsed.daily_table) ? parsed.daily_table : [],
      long_downtime: Array.isArray(parsed.long_downtime) ? parsed.long_downtime : [],
      recurring: Array.isArray(parsed.recurring) ? parsed.recurring : [],
      quality_issues: Array.isArray(parsed.quality_issues) ? parsed.quality_issues : [],
      process_changes: Array.isArray(parsed.process_changes) ? parsed.process_changes : [],
      tests_inspections: Array.isArray(parsed.tests_inspections) ? parsed.tests_inspections : [],
    };
  } catch (e) {
    console.error("[PE 큐레이션 실패]", e);
    // 폴백: 데이터 기반 자동 생성 (API 호출 없이)
    return buildFallbackCuration(allIssues, categoryMsgs);
  }
}

// PE 큐레이션 폴백 - 데이터 기반 자동 생성
function buildFallbackCuration(allIssues, categoryMsgs = {}) {
  // 일자별 정리 (각 일자에서 가장 부동시간 긴 이슈)
  const byDate = {};
  for (const issue of allIssues) {
    const d = issue.date || "?";
    if (!byDate[d] || (issue.durMin || 0) > (byDate[d].durMin || 0)) {
      byDate[d] = issue;
    }
  }
  const daily_table = Object.entries(byDate).map(([date, issue]) => ({
    date,
    equipment: issue.eq || "-",
    issue: (issue.prob || "").slice(0, 50),
    action: (issue.result || "").slice(0, 50),
    downtime: issue.durMin || 0,
  })).slice(0, 10);

  // 장기 부동 (60분 이상 또는 미해결)
  const long_downtime = allIssues
    .filter(i => (i.durMin || 0) >= 60 || (i.result || "").toLowerCase().includes("not solved"))
    .slice(0, 5)
    .map(i => ({
      equipment: i.eq || "-",
      reason: (i.cause || i.prob || "").slice(0, 60),
      since: i.date || "",
      status: (i.result || "").toLowerCase().includes("solved") ? "완료" : "진행형",
      duration_note: `${i.durMin || 0}분`,
    }));

  // 반복 항목 (Equipment 기준 2회 이상)
  const eqCount = {};
  for (const i of allIssues) {
    if (!i.eq) continue;
    eqCount[i.eq] = (eqCount[i.eq] || 0) + 1;
  }
  const recurring = Object.entries(eqCount)
    .filter(([, c]) => c >= 2)
    .slice(0, 5)
    .map(([eq, count]) => ({
      item: eq,
      lines: [eq],
      count,
      cause: "(데이터 기반 자동 추출 - 상세 원인 추가 분석 필요)",
    }));

  // 영역 5: 카테고리 메시지를 단순 매핑하여 폴백 생성
  const mapMsgs = (arr, extraField) => (arr || []).slice(0, 15).map(m => ({
    date: m.date || "",
    time: m.time || "",
    item: (m.text || "").slice(0, 50).replace(/\n/g, " "),
    [extraField]: m.sender || "-",
  }));

  return {
    summary_text: `[PE 큐레이션 폴백] 총 ${allIssues.length}건의 부동 이슈 발생. AI 큐레이션 호출 실패로 자동 정리됨.`,
    daily_table,
    long_downtime,
    recurring,
    quality_issues: mapMsgs(categoryMsgs.quality, "note"),
    process_changes: mapMsgs(categoryMsgs.process_change, "who"),
    tests_inspections: mapMsgs(categoryMsgs.test, "purpose"),
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
async function callPersona(personaCode, issueCtx, prevOpinions, kbText, reportType, isPostAction = false) {
  // isPostAction: true이면 기조치 건 (기존 조치 적절성 평가 강조)
  const p = PERSONAS[personaCode];
  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const kb = kbText ? `\n\n[학습 내용]\n${kbText.slice(0, 500)}` : "";

  // 이전 발언자 의견 (대화체 인용용)
  const prevText = prevOpinions.length > 0
    ? `\n\n[먼저 발언한 동료 의견]\n${prevOpinions.map(o => {
        const op = o.opinion || {};
        return `── ${PERSONAS[o.persona]?.label} (${o.persona}) ──
[현상] ${op["현상"] || "-"}
[원인] ${op["원인"] || "-"}
[대책] ${op["대책"] || "-"}
[기존조치 평가] ${op["기존조치_평가"] || "-"}`;
      }).join("\n\n")}`
    : "";

  const conversationGuide = prevOpinions.length > 0
    ? `\n\n[대화 진행 방식]
- 위 동료 의견을 직접 언급/인용하며 대화체로 작성하세요 (예: "Cell_TE의 온도 분석에 대해 동의합니다만...", "ME가 지적한 베어링 마모 외에...")
- previous_reference 필드에 누구의 어떤 의견을 받아 답하는지 명시
- stance 필드에 동의/부분동의/반대/추가의견 중 선택`
    : `\n\n[첫 발언자 안내]\n- 당신이 첫 발언자입니다. previous_reference는 빈 문자열, stance는 "초기분석"`;

  const postActionGuide = isPostAction
    ? `\n\n[★ 기조치 건 - 추가 강조 사항]
- 이미 조치가 시도된 건입니다. "기존조치_평가" 필드에 반드시 기존 조치의 적절성을 분석하세요.
- 평가 기준: ① 적절했는지 ② 부족한 점 ③ 추가로 필요한 보완책
- "대책" 필드에는 보완책/재발방지책에 집중하세요.`
    : "";

  const sys = `${FACTORY_PHILOSOPHY}

당신은 AZS 배터리 공장 ${p.role}입니다.

[우선순위] ${p.priority}
[관심 영역] ${p.focus}
[입장] ${p.stance}${kb}

${focus} 다음 이슈를 ${p.role.split(" ")[0]} 관점에서 분석하세요.${conversationGuide}${postActionGuide}

[필수 출력 - JSON만]
{
  "previous_reference": "이전 동료 의견 인용 (첫 발언자는 빈 문자열, 60자이내)",
  "stance": "동의/부분동의/반대/추가의견/초기분석 중 하나",
  "현상": "내 직무 관점에서 본 현상 (80자이내)",
  "원인": "1차 원인 + 근본 원인 (100자이내)",
  "대책": "구체적 대책 또는 보완책 (80자이내)",
  "기존조치_평가": "이미 시도된 조치의 적절성·부족함 분석 (80자이내, 기조치 건이 아니면 '해당없음')"
}`;

  try {
    await new Promise(r => setTimeout(r, 600));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}${prevText}`, {
      model: MODEL_REASONING,
      max_tokens: 800,  // 6필드 수용 (기존 500에서 증가)
    });
    return safeJSON(raw);
  } catch {
    return {
      previous_reference: "",
      stance: "분석 오류",
      "현상": "분석 중 오류",
      "원인": "-",
      "대책": "-",
      "기존조치_평가": "-",
    };
  }
}

// ─── 4. 사회자: DEEP 5섹션 ─────────────────────────────────────────────────────
async function moderateDeep(issueCtx, opinions) {
  const opinionsText = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return `── ${p.label} (${o.persona}) [${op.stance || "-"}] ──
[이전 발언 인용] ${op.previous_reference || "(첫 발언자)"}
[현상] ${op["현상"] || "-"}
[원인] ${op["원인"] || "-"}
[대책] ${op["대책"] || "-"}
[기존조치 평가] ${op["기존조치_평가"] || "-"}`;
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

  await new Promise(r => setTimeout(r, 500));
  const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n[엔지니어 의견]\n${opinionsText}\n\n5섹션 형식으로 종합 정리하세요.`, {
    model: MODEL_REASONING,
    max_tokens: 800,
  });
  return safeJSON(raw);
}

// ─── 5. 사회자: STANDARD 액션플랜 ──────────────────────────────────────────────
async function moderateStandard(issueCtx, opinions) {
  const opinionsText = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return `── ${p.label} (${o.persona}) [${op.stance || "-"}] ──
[현상] ${op["현상"] || "-"}
[원인] ${op["원인"] || "-"}
[대책] ${op["대책"] || "-"}
[기존조치 평가] ${op["기존조치_평가"] || "-"}`;
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

  await new Promise(r => setTimeout(r, 500));
  const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx}\n\n[의견]\n${opinionsText}\n\n액션 플랜으로 정리.`, {
    model: MODEL_REASONING,
    max_tokens: 700,
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

// ─── 6-1. 사회자 3단계 폴백 통합 함수 ───────────────────────────────────────────
async function moderateWithFallback(mode, issueCtx, opinions) {
  // 1차: 정상 호출
  try {
    let primary;
    if (mode === "DEEP")     primary = await moderateDeep(issueCtx, opinions);
    else if (mode === "STANDARD") primary = await moderateStandard(issueCtx, opinions);
    else if (mode === "LITE")     primary = await moderateLite(issueCtx);
    else throw new Error(`Unknown mode: ${mode}`);

    return { ...primary, _fallback_level: "primary" };
  } catch (e1) {
    console.warn(`[Moderator 1차 실패] ${mode}:`, e1.message);

    // 2차: 단순 프롬프트로 재시도
    try {
      const retry = await moderateRetrySimple(mode, issueCtx, opinions);
      return { ...retry, _fallback_level: "retry" };
    } catch (e2) {
      console.warn(`[Moderator 2차 실패] ${mode}:`, e2.message);

      // 3차: 코드 레벨 자동 생성 (API 호출 없음)
      const codeFallback = codeFallbackModerator(mode, opinions);
      return { ...codeFallback, _fallback_level: "code_fallback" };
    }
  }
}

// 2차 재시도 - 더 단순한 프롬프트 + 더 짧은 출력 요구
async function moderateRetrySimple(mode, issueCtx, opinions) {
  const opinionsCompact = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return `${p.label}: 현상=${op["현상"] || "-"} / 원인=${op["원인"] || "-"} / 대책=${op["대책"] || "-"}`;
  }).join("\n");

  if (mode === "DEEP") {
    const sys = `다음 의견들을 5섹션으로 짧게 종합하세요. JSON만:
{"consensus":"합의","differences":"차이","conflicts":"충돌","recommendation":"권고","needsMore":"추가"}`;
    await new Promise(r => setTimeout(r, 400));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx.slice(0, 300)}\n\n[의견]\n${opinionsCompact}`, {
      model: MODEL_REASONING,
      max_tokens: 500,
    });
    return safeJSON(raw);
  }

  if (mode === "STANDARD") {
    const sys = `다음 의견을 액션 플랜으로 짧게 정리. JSON만:
{"summary":"요약","actions":[{"action":"행동","owner":"담당","priority":"우선순위","duration":"기간"}],"needsMore":"추가"}`;
    await new Promise(r => setTimeout(r, 400));
    const raw = await callClaudeRaw(sys, `[이슈]\n${issueCtx.slice(0, 300)}\n\n[의견]\n${opinionsCompact}`, {
      model: MODEL_REASONING,
      max_tokens: 500,
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

// 3차 폴백 - 코드 레벨 자동 생성 (페르소나 의견을 직접 합쳐 결과 생성)
function codeFallbackModerator(mode, opinions) {
  // 페르소나별 의견 간단 정리
  const opinionsByPersona = opinions.map(o => {
    const p = PERSONAS[o.persona];
    const op = o.opinion || {};
    return {
      label: p?.label || o.persona,
      code: o.persona,
      stance: op.stance || "-",
      현상: op["현상"] || "(의견 없음)",
      원인: op["원인"] || "(의견 없음)",
      대책: op["대책"] || "(의견 없음)",
      기존조치_평가: op["기존조치_평가"] || "해당없음",
    };
  });

  // 합의 추출 시도 (모두 비슷한 단어가 있는지)
  const allCauses = opinionsByPersona.map(o => o.원인).join(" ");
  const allActions = opinionsByPersona.map(o => o.대책).join(" ");

  // 충돌 추출 (반대 stance가 있는지)
  const stances = opinionsByPersona.map(o => o.stance);
  const hasConflict = stances.includes("반대") || stances.includes("부분동의");

  if (mode === "DEEP") {
    const consensus = opinionsByPersona.length > 0
      ? `${opinionsByPersona.length}명의 엔지니어가 본 이슈를 분석함. 자동 종합 모드 (사회자 호출 실패).`
      : "분석 의견이 수집되지 않음";
    const differences = opinionsByPersona
      .map(o => `${o.label}: ${o.원인.slice(0, 50)} → ${o.대책.slice(0, 50)}`)
      .join(" / ");
    const conflicts = hasConflict
      ? `반대/부분동의 의견 존재 (${stances.filter(s => s === "반대" || s === "부분동의").length}건)`
      : "명시적 충돌 없음";
    const recommendation = `자동 종합: ${opinionsByPersona[0]?.대책 || "-"} 우선 검토 필요. 사회자 자동 종합 실패로 수동 검토 권장.`;
    const needsMore = "★ 사회자 호출 실패 — 위 내용을 직접 검토해주세요. 페르소나 개별 의견을 참조하세요.";

    return { consensus, differences, conflicts, recommendation, needsMore };
  }

  if (mode === "STANDARD") {
    const summary = `${opinionsByPersona.length}명 의견 자동 정리 (사회자 호출 실패)`;
    const actions = opinionsByPersona.map(o => ({
      action: o.대책.slice(0, 60),
      owner: o.code,
      priority: o.stance === "반대" ? "낮음" : "중간",
      duration: "검토 필요",
    }));
    const needsMore = "★ 사회자 호출 실패 — 페르소나 의견 직접 검토 필요";

    return { summary, actions, needsMore };
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

  // ─── LITE 모드: 사회자만 단독 호출 (1회) ───
  if (modeInfo.mode === "LITE") {
    onProgress?.(`🟢 LITE 모드 - 사회자 단독 평가${isPostAction ? " (기조치)" : ""}`);
    const result = await moderateWithFallback("LITE", issueCtx, []);
    return {
      issue, modeInfo, isPostAction,
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

  // [2] 페르소나 순차 호출 (대화체 + JSON 스키마 + 기조치 평가)
  const opinions = [];
  for (const personaCode of router.order) {
    const p = PERSONAS[personaCode];
    onProgress?.(`${p.icon} ${p.label} 의견 수렴 중... (${opinions.length + 1}/${router.order.length})`);
    const opinion = await callPersona(personaCode, issueCtx, opinions, kb[personaCode] || "", reportType, isPostAction);
    opinions.push({ persona: personaCode, opinion });
  }

  // [3] 사회자 (모드별 분기 + 3단계 폴백)
  onProgress?.(`📋 사회자 종합 중... (${modeInfo.mode})`);
  const result = await moderateWithFallback(modeInfo.mode, issueCtx, opinions);
  const moderator = { type: modeInfo.mode.toLowerCase(), ...result };

  if (result._fallback_level && result._fallback_level !== "primary") {
    onProgress?.(`⚠️ 사회자 폴백 사용: ${result._fallback_level}`);
  }

  return { issue, modeInfo, isPostAction, router, opinions, moderator };
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
긴급: ${priority.urgent.length}건 / 중요: ${priority.important.length}건 / 일반: ${priority.normal.length}건
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
    agenda: `다운타임 ${priority.urgent.length + priority.important.length + priority.normal.length}건 분석 및 대책 수립`,
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

  // ★ 영역 6: 이슈 안정 ID (체크박스 추적용)
  const getIssueId = (issue) => `${issue.date || "?"}_${issue.time || "?"}_${issue.eq || "?"}_${(issue.prob || "").slice(0, 20)}`;

  const handleReportConfirm = async () => {
    setError("");
    const dayMsgs = filterByDates(allMsgs, selDates);
    const cl = classifyMessages(dayMsgs);
    const pri = classifyPriority(cl.downtime);
    setClassified(cl);
    setPriority(pri);

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

      // PE 큐레이션 실행 (KB 없이 진행 — STEP 3에선 빠르게)
      const allIssuesForCuration = [...pri.urgent, ...pri.important, ...pri.normal];
      let curation;
      try {
        curation = await runPreCuration(allIssuesForCuration, "", reportType, categoryMsgs);
        setProgress(p => [...p, `✅ PE 큐레이션 완료 (장기부동 ${curation.long_downtime.length}건, 반복 ${curation.recurring.length}건)`]);
      } catch {
        setProgress(p => [...p, `⚠️ PE 큐레이션 실패 — 폴백 사용`]);
        curation = buildFallbackCuration(allIssuesForCuration, categoryMsgs);
      }

      // 자동 선정 (긴급 + 중요 후보 중 점수 상위 MAX_ISSUES건)
      const autoTop = selectKeyIssues(pri);
      const autoIds = autoTop.map(getIssueId);

      setPreCuration(curation);
      setPreCategoryMsgs(categoryMsgs);
      setAutoSelectedIds(autoIds);
      setSelectedIssueIds(autoIds);  // 초기값 = 자동 선정 (사용자가 추가/제거 가능)
      setProgress(p => [...p, `🎯 자동 선정 ${autoIds.length}건. 추가 선택 후 분석 시작 가능.`]);
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

      // ★ 영역 6: STEP 3에서 사용자가 체크한 이슈를 분석 대상으로 사용
      // 자동 선정 + 사용자 추가 = selectedIssueIds (체크박스로 자유 선택)
      // 매뉴얼 추가 이슈는 점수 계산 후 score 부여 (정렬 일관성)
      const candidates = [...priority.urgent, ...priority.important];
      const candidatesScored = candidates.map(issue => {
        const s = scoreIssue(issue);
        return { ...issue, score: s.total, scoreBreakdown: s.breakdown };
      });
      const keyIssues = candidatesScored
        .filter(issue => selectedIssueIds.includes(getIssueId(issue)))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (b.durMin || 0) - (a.durMin || 0);
        });

      const liteIssues = priority.normal.slice(0, MAX_ISSUES);
      const allTargets = [...keyIssues, ...liteIssues];

      const autoCount = keyIssues.filter(i => autoSelectedIds.includes(getIssueId(i))).length;
      const manualCount = keyIssues.length - autoCount;
      setProgress(p => [...p, `🔍 본문 논의: 자동 ${autoCount}건 + 매뉴얼 ${manualCount}건 = 총 ${keyIssues.length}건 + 일반(LITE) ${liteIssues.length}건`]);

      // ★ 영역 6-E: STEP 3에서 미리 실행한 큐레이션 재사용 (재호출 없음)
      const allIssuesForCuration = [...priority.urgent, ...priority.important, ...priority.normal];
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

        const result = await runIssueDiscussion(issue, modeInfo, kbResult.kb, reportType, allowedAgents, (msg) => {
          setProgress(p => [...p, `   ${msg}`]);
        });
        allDiscussions.push(result);
        setDiscussions([...allDiscussions]);
      }

      // 일반(LITE) 처리
      for (let i = 0; i < liteIssues.length; i++) {
        const issue = liteIssues[i];
        const modeInfo = classifyDiscussionMode(issue, false, false);
        if (modeInfo.mode === "DEEP") {
          setProgress(p => [...p, `🚨 LITE 후보였으나 키워드 감지로 DEEP 강제: ${issue.eq}`]);
        }
        setProgress(p => [...p, `${MODE_STYLE[modeInfo.mode].label} [LITE-${i+1}/${liteIssues.length}] ${issue.eq}`]);
        const result = await runIssueDiscussion(issue, modeInfo, kbResult.kb, reportType, allowedAgents);
        allDiscussions.push(result);
        setDiscussions([...allDiscussions]);
      }

      // 보고서 생성
      setProgress(p => [...p, "📄 보고서 생성 중..."]);
      const dateStr = selDates.length > 1 ? `${selDates[0]}~${selDates[selDates.length-1]}` : selDates[0];
      const allIssuesForAnalytics = [...priority.urgent, ...priority.important, ...priority.normal];
      const report = await generateReport(dateStr, selDates, allDiscussions, priority, reportType, kbResult.kb, allIssuesForAnalytics, selectedProcess, curation);
      // ★ 보고서에 공정/참여 에이전트 정보 추가
      report.process = selectedProcess;
      report.allowedAgents = allowedAgents;
      setMinutes(report);

      // 시트 저장
      setProgress(p => [...p, "💾 구글 시트 저장 중..."]);
      const deepSummary = report.grouped.DEEP.map(d => `${d.issue.eq}: ${d.moderator.consensus}`).join(" | ");
      const stdSummary = report.grouped.STANDARD.map(d => `${d.issue.eq}: ${d.moderator.summary}`).join(" | ");
      const liteSummary = report.grouped.LITE.map(d => `${d.issue.eq}: ${d.moderator.supplement}`).join(" | ");

      const saved = await saveToSheets({
        date: dateStr,
        agenda: `[${selectedProcess} 공정] ${report.agenda}`,
        issue_summary: `긴급${priority.urgent.length} 중요${priority.important.length} 일반${priority.normal.length} | DEEP${report.grouped.DEEP.length} STANDARD${report.grouped.STANDARD.length} LITE${report.grouped.LITE.length}`,
        pe_opinion: deepSummary.slice(0, 500),
        me_opinion: stdSummary.slice(0, 500),
        te_opinion: liteSummary.slice(0, 500),
        discussion: report.sections.map(s => `${s.heading}: ${(s.items||[]).join(", ")}`).join(" / ").slice(0, 2000),
        action_items: report.sections[3]?.items?.join(" | ") || "",
        minutes_full: JSON.stringify({
          process: selectedProcess,
          agents: allowedAgents,
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
    if (minutes.process && minutes.allowedAgents) {
      t += `대상 공정: ${PROCESSES[minutes.process]?.label || minutes.process}\n`;
      t += `참여 에이전트 (${minutes.allowedAgents.length}명): ${minutes.allowedAgents.map(a => `${a}(${PERSONAS[a]?.label})`).join(", ")}\n`;
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
      if (selDates.length > 0) parts.push(`분석 대상 일자: ${selDates.join(", ")}`);
    }
    if (priority) {
      parts.push(`이슈 분류: 긴급 ${priority.urgent.length}건 / 중요 ${priority.important.length}건 / 일반 ${priority.normal.length}건`);
      const top = [...priority.urgent, ...priority.important].slice(0, 15);
      if (top.length > 0) {
        parts.push("\n[주요 이슈 목록 (상위 15건)]");
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
    setClassified(null); setPriority(null); setKbStats(null);
    setDiscussions([]); setMinutes(null); setProgress([]);
    setError(""); setSheetSaved(false); setReportType("meeting");
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
                🔍 차등 논의 모드 (예상) · 참여 {PROCESSES[selectedProcess].auto.length + extraAgents.length}명
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

            {/* ★ 영역 6-C: 본문 논의 후보 목록 (긴급+중요 통합, 체크박스 + 자동선정 표시) */}
            {!curating && (priority.urgent.length > 0 || priority.important.length > 0) && (() => {
              // 긴급+중요 후보를 점수순으로 정렬해서 한 목록에 표시
              const candidates = [...priority.urgent, ...priority.important];
              const scored = candidates.map(issue => {
                const s = scoreIssue(issue);
                return { ...issue, score: s.total, scoreBreakdown: s.breakdown };
              }).sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return (b.durMin || 0) - (a.durMin || 0);
              });
              const total = scored.length;
              const sel = selectedIssueIds.length;
              return (
                <div style={{
                  background:"rgba(15,23,42,0.6)", border:"1px solid rgba(100,116,139,0.3)",
                  borderRadius:10, padding:"12px 14px", marginBottom:12,
                }}>
                  <div style={{
                    display:"flex", justifyContent:"space-between", alignItems:"center",
                    marginBottom:8, paddingBottom:8, borderBottom:"1px solid rgba(51,65,85,0.4)",
                  }}>
                    <div style={{fontSize:11,color:"#cbd5e1",fontWeight:800}}>
                      📋 본문 논의 후보 ({total}건) — 자동 선정 ⭐ 표시 / 체크박스로 자유 선택
                    </div>
                    <div style={{fontSize:10,color:"#22d3ee",fontWeight:700}}>
                      선택 {sel}건 / {total}건
                    </div>
                  </div>

                  {/* 일괄 액션 버튼 */}
                  <div style={{display:"flex",gap:6,marginBottom:8}}>
                    <button onClick={()=>setSelectedIssueIds(scored.map(getIssueId))} style={{
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

                  {/* 후보 목록 (스크롤) */}
                  <div style={{maxHeight:360, overflowY:"auto"}}>
                    {scored.map((d) => {
                      const id = getIssueId(d);
                      const isAuto = autoSelectedIds.includes(id);
                      const isChecked = selectedIssueIds.includes(id);
                      const isUrgent = priority.urgent.includes(d);
                      const tagColor = isUrgent ? "#ef4444" : "#f59e0b";
                      const tagLabel = isUrgent ? "🔴 긴급" : "🟡 중요";
                      return (
                        <label key={id} style={{
                          display:"flex", alignItems:"flex-start", gap:8,
                          padding:"8px 10px", marginBottom:4, borderRadius:6,
                          background: isChecked ? "rgba(34,211,238,0.06)" : "rgba(15,23,42,0.4)",
                          border:`1px solid ${isChecked ? "rgba(34,211,238,0.3)" : "rgba(51,65,85,0.3)"}`,
                          cursor:"pointer",
                        }}>
                          <input type="checkbox" checked={isChecked}
                            onChange={()=>toggleIssueSelection(id)}
                            style={{marginTop:3, cursor:"pointer", accentColor:"#22d3ee"}}/>
                          <div style={{flex:1, fontSize:10, lineHeight:1.5}}>
                            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:3}}>
                              <span style={{
                                fontSize:9, padding:"1px 6px", borderRadius:3,
                                background:`${tagColor}22`, color:tagColor, fontWeight:700,
                              }}>{tagLabel}</span>
                              {isAuto && (
                                <span style={{
                                  fontSize:9, padding:"1px 6px", borderRadius:3,
                                  background:"rgba(245,158,11,0.15)", color:"#fbbf24", fontWeight:700,
                                }}>⭐ 자동선정</span>
                              )}
                              <span style={{color:"#94a3b8"}}>{d.date} {d.time}</span>
                              <span style={{color:"#cbd5e1",fontWeight:700}}>{d.eq}</span>
                              <span style={{color:"#94a3b8"}}>· {d.durMin}분</span>
                              <span style={{
                                marginLeft:"auto",
                                fontSize:9, padding:"1px 6px", borderRadius:3,
                                background:"rgba(34,211,238,0.1)", color:"#22d3ee", fontWeight:700,
                              }}>점수 {d.score}</span>
                            </div>
                            {d.prob && d.prob !== "-" && (
                              <div style={{color:"#cbd5e1",marginBottom:2}}>
                                <span style={{color:"#64748b"}}>Problem:</span> {d.prob}
                              </div>
                            )}
                            {d.cause && d.cause !== "-" && (
                              <div style={{color:"#94a3b8",marginBottom:2}}>
                                <span style={{color:"#64748b"}}>Cause:</span> {d.cause}
                              </div>
                            )}
                            {d.result && d.result !== "-" && (
                              <div style={{color:"#94a3b8",marginBottom:2}}>
                                <span style={{color:"#64748b"}}>Result:</span> {d.result}
                              </div>
                            )}
                            {d.reasons?.length > 0 && (
                              <div style={{color:"#64748b",fontSize:9}}>
                                ({d.reasons.join(", ")})
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
                      score = 부동(분)/30 + 반복횟수×3 + 안전환경(+10) + 미해결(+5) + FullStop(+5)
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

            {/* ★ PE 사전 큐레이션 (보고서 1부 - 전체 정리) */}
            {minutes.curation && (
              <div style={{
                background:"rgba(15,23,42,0.7)",
                border:"1px solid rgba(59,130,246,0.3)",
                borderRadius:10, padding:"14px 16px", marginBottom:14,
              }}>
                <div style={{fontSize:12,fontWeight:800,color:"#3b82f6",marginBottom:10}}>
                  📝 PE 사전 큐레이션 — 전체 이슈 정리
                </div>

                {/* 요약 텍스트 */}
                <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.7,marginBottom:12,padding:"8px 10px",background:"rgba(59,130,246,0.06)",borderRadius:6}}>
                  {minutes.curation.summary_text}
                </div>

                {/* 일자별 표 */}
                {minutes.curation.daily_table?.length > 0 && (
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,marginBottom:6}}>
                      📅 일자별 주요 이슈
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",fontSize:10,borderCollapse:"collapse"}}>
                        <thead>
                          <tr style={{background:"rgba(59,130,246,0.15)"}}>
                            <th style={{padding:"5px 8px",textAlign:"left",color:"#60a5fa",border:"1px solid rgba(51,65,85,0.4)"}}>일자</th>
                            <th style={{padding:"5px 8px",textAlign:"left",color:"#60a5fa",border:"1px solid rgba(51,65,85,0.4)"}}>호기</th>
                            <th style={{padding:"5px 8px",textAlign:"left",color:"#60a5fa",border:"1px solid rgba(51,65,85,0.4)"}}>주요 내용</th>
                            <th style={{padding:"5px 8px",textAlign:"left",color:"#60a5fa",border:"1px solid rgba(51,65,85,0.4)"}}>조치</th>
                            <th style={{padding:"5px 8px",textAlign:"right",color:"#60a5fa",border:"1px solid rgba(51,65,85,0.4)"}}>분</th>
                          </tr>
                        </thead>
                        <tbody>
                          {minutes.curation.daily_table.map((row, i) => (
                            <tr key={i}>
                              <td style={{padding:"5px 8px",color:"#e2e8f0",border:"1px solid rgba(51,65,85,0.4)",whiteSpace:"nowrap"}}>{row.date}</td>
                              <td style={{padding:"5px 8px",color:"#e2e8f0",border:"1px solid rgba(51,65,85,0.4)",whiteSpace:"nowrap"}}>{row.equipment}</td>
                              <td style={{padding:"5px 8px",color:"#cbd5e1",border:"1px solid rgba(51,65,85,0.4)"}}>{row.issue}</td>
                              <td style={{padding:"5px 8px",color:"#cbd5e1",border:"1px solid rgba(51,65,85,0.4)"}}>{row.action}</td>
                              <td style={{padding:"5px 8px",color:row.downtime >= 60 ? "#ef4444" : "#94a3b8",textAlign:"right",fontWeight:row.downtime >= 60 ? 700 : 400,border:"1px solid rgba(51,65,85,0.4)"}}>{row.downtime}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 장기 부동 */}
                {minutes.curation.long_downtime?.length > 0 && (
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:10,color:"#ef4444",fontWeight:700,marginBottom:6}}>
                      ⏰ 장기 부동 ({minutes.curation.long_downtime.length}건)
                    </div>
                    {minutes.curation.long_downtime.map((d, i) => (
                      <div key={i} style={{fontSize:10,padding:"6px 10px",background:"rgba(239,68,68,0.08)",borderRadius:5,marginBottom:4}}>
                        <span style={{color:"#fca5a5",fontWeight:700}}>{d.equipment}</span>
                        <span style={{color:"#94a3b8"}}> | {d.reason}</span>
                        <span style={{color:"#fbbf24",marginLeft:6}}>({d.duration_note})</span>
                        {d.status && <span style={{color:"#ef4444",fontSize:9,marginLeft:6}}>{d.status}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* 반복 항목 */}
                {minutes.curation.recurring?.length > 0 && (
                  <div>
                    <div style={{fontSize:10,color:"#f59e0b",fontWeight:700,marginBottom:6}}>
                      🔁 반복 발생 항목 ({minutes.curation.recurring.length}건)
                    </div>
                    {minutes.curation.recurring.map((r, i) => (
                      <div key={i} style={{fontSize:10,padding:"6px 10px",background:"rgba(245,158,11,0.08)",borderRadius:5,marginBottom:4}}>
                        <span style={{color:"#fcd34d",fontWeight:700}}>{r.item}</span>
                        <span style={{color:"#94a3b8"}}> ({r.count}회) </span>
                        <span style={{color:"#cbd5e1"}}>{r.lines?.join(", ")}</span>
                        {r.cause && <div style={{color:"#94a3b8",marginTop:2}}>원인: {r.cause}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* ★ 영역 5-H: 품질 이슈 이력 */}
                {minutes.curation.quality_issues?.length > 0 && (
                  <div style={{marginTop:12}}>
                    <div style={{fontSize:10,color:"#a78bfa",fontWeight:700,marginBottom:6}}>
                      🧪 품질 이슈 이력 ({minutes.curation.quality_issues.length}건)
                    </div>
                    {minutes.curation.quality_issues.map((q, i) => (
                      <div key={i} style={{fontSize:10,padding:"6px 10px",background:"rgba(167,139,250,0.08)",borderRadius:5,marginBottom:4}}>
                        <span style={{color:"#94a3b8"}}>{q.date} {q.time}</span>{" "}
                        <span style={{color:"#cbd5e1"}}>{q.item}</span>
                        {q.note && q.note !== "-" && <span style={{color:"#94a3b8"}}> · {q.note}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* ★ 영역 5-H: 공정/설비 조건변경 이력 */}
                {minutes.curation.process_changes?.length > 0 && (
                  <div style={{marginTop:12}}>
                    <div style={{fontSize:10,color:"#34d399",fontWeight:700,marginBottom:6}}>
                      ⚙️ 공정/설비 조건변경 이력 ({minutes.curation.process_changes.length}건)
                    </div>
                    {minutes.curation.process_changes.map((c, i) => (
                      <div key={i} style={{fontSize:10,padding:"6px 10px",background:"rgba(52,211,153,0.08)",borderRadius:5,marginBottom:4}}>
                        <span style={{color:"#94a3b8"}}>{c.date} {c.time}</span>{" "}
                        <span style={{color:"#cbd5e1"}}>{c.item}</span>
                        {c.who && c.who !== "-" && <span style={{color:"#94a3b8"}}> · {c.who}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* ★ 영역 5-H: 테스트/양산외 생산 이력 */}
                {minutes.curation.tests_inspections?.length > 0 && (
                  <div style={{marginTop:12}}>
                    <div style={{fontSize:10,color:"#22d3ee",fontWeight:700,marginBottom:6}}>
                      🔬 테스트/양산외 생산 이력 ({minutes.curation.tests_inspections.length}건)
                    </div>
                    {minutes.curation.tests_inspections.map((t, i) => (
                      <div key={i} style={{fontSize:10,padding:"6px 10px",background:"rgba(34,211,238,0.08)",borderRadius:5,marginBottom:4}}>
                        <span style={{color:"#94a3b8"}}>{t.date} {t.time}</span>{" "}
                        <span style={{color:"#cbd5e1"}}>{t.item}</span>
                        {t.purpose && t.purpose !== "-" && <span style={{color:"#94a3b8"}}> · {t.purpose}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

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
  const [showDetailCard, setShowDetailCard] = useState(false);
  const { issue, modeInfo, isPostAction, router, opinions, moderator } = discussion;
  const mStyle = MODE_STYLE[modeInfo.mode];
  const fallbackLevel = moderator?._fallback_level || "primary";
  const detailCard = buildIssueDetailCard(discussion);

  // 폴백 배지
  const fbBadge = fallbackLevel === "primary" ? null
    : fallbackLevel === "retry" ? { label: "🔁 재시도 성공", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" }
    : { label: "⚠️ 코드 폴백", color: "#ef4444", bg: "rgba(239,68,68,0.15)" };

  return (
    <div style={{
      background:"rgba(15,23,42,0.7)",
      border:`1px solid ${mStyle.border}`,
      borderRadius:10, padding:"14px 16px", marginBottom:8,
    }}>
      {/* 헤더 */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8,gap:8,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:11,fontWeight:800,color:mStyle.color}}>
            [{issue.time}] {issue.eq}
            {isPostAction && (
              <span style={{
                marginLeft:6, fontSize:9, padding:"1px 6px",
                background:"rgba(52,211,153,0.15)", color:"#34d399",
                borderRadius:8, fontWeight:700,
              }}>✓ 기조치</span>
            )}
          </div>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:2}}>
            {issue.durMin}분 · {issue.prob}
          </div>
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
