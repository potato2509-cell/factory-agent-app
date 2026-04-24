import { useState, useRef, useEffect } from "react";

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE9ZyopUTxEEXpt3UjWjfgDljEiGodgbunj_UnXYc-1RlrXgNiDzAiikXoEP4g9_E/exec";
const MAX_ISSUES = 10; // 긴급+중요 최대 처리 건수

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
  const results = await Promise.allSettled([
    loadKnowledge("Cell_PE"),
    loadKnowledge("Cell_ME"),
    loadKnowledge("Cell_TE"),
  ]);
  const [peR, meR, teR] = results;
  const pe = peR.status === "fulfilled" ? peR.value : "";
  const me = meR.status === "fulfilled" ? meR.value : "";
  const te = teR.status === "fulfilled" ? teR.value : "";
  const stats = {
    pe: pe ? pe.split("\n").filter(Boolean).length : 0,
    me: me ? me.split("\n").filter(Boolean).length : 0,
    te: te ? te.split("\n").filter(Boolean).length : 0,
    failed: results.filter(r => r.status === "rejected").length,
  };
  return { pe, me, te, stats };
}

// ─── Claude API ────────────────────────────────────────────────────────────────
async function callClaudeRaw(system, userMsg) {
  let res;
  try {
    res = await fetch("/.netlify/functions/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, userMsg, max_tokens: 1000 }),
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
  // 잘린 JSON 복구 시도
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

// ─── WhatsApp 파서 ─────────────────────────────────────────────────────────────
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

// 06시 기준 생산일 계산
function getProductionDate(date, hour) {
  if (hour < 6) {
    // 전날 생산분
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

// 날짜에서 해당 주 월~일 반환
function getWeekDates(dateStr) {
  const parts = dateStr.split("/").map(Number);
  const d = new Date(2000 + parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay(); // 0=일, 1=월
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

// ─── 이슈 파싱 ─────────────────────────────────────────────────────────────────
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
      downtime.push({ time: m.time, text: full });
      i = j;
    } else if (m.text.match(/cutter|limit|⚠️|🟡|cathode|anode/i)) {
      equipment.push({ time: m.time, sender: m.sender, text: m.text });
      i++;
    } else {
      if (m.text.trim().length > 5) general.push({ time: m.time, sender: m.sender, text: m.text });
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

// 심층 논의 대상 이슈 선택 (긴급+중요 최대 10건)
function selectKeyIssues(priority) {
  const all = [...priority.urgent, ...priority.important];
  return all.slice(0, MAX_ISSUES);
}

// ─── AI 분석 함수들 ────────────────────────────────────────────────────────────

// 개별 이슈 심층 분석 (PE·ME·TE)
async function analyzeIssueDeep(issue, kb, reportType, issueNum, totalIssues) {
  const issueCtx = `
설비: ${issue.eq}
발생시간: ${issue.time}
다운타임: ${issue.durMin}분
문제: ${issue.prob}
원인: ${issue.cause}
결과: ${issue.result}
담당자: ${issue.pic}
우선순위: ${issue.reasons?.join(", ")}
`.trim();

  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;

  const analyses = {};
  for (const [role, roleKB, roleLabel] of [
    ["Cell_PE", kb.pe, "생산 엔지니어"],
    ["Cell_ME", kb.me, "설비 엔지니어"],
    ["Cell_TE", kb.te, "기술 엔지니어"],
  ]) {
    const kbText = roleKB ? `\n\n[학습 내용]\n${roleKB.slice(0, 500)}` : "";
    const sys = `당신은 AZS 배터리 공장 Cell 라인 ${roleLabel}(${role}). 한국어.${kbText}
${focus} 아래 이슈를 상세 분석하세요.
JSON만 출력:
{"analysis":"이슈 원인 및 영향 상세 분석 (100자이내)","action":"즉시 조치사항 (60자이내)","prevention":"재발방지 방안 (60자이내)"}`;
    try {
      await new Promise(r => setTimeout(r, 800));
      const raw = await callClaudeRaw(sys, `[이슈 ${issueNum}/${totalIssues}] ${issueCtx}\n${role} 관점으로 상세 분석하세요.`);
      analyses[role] = safeJSON(raw);
    } catch {
      analyses[role] = { analysis: "분석 중 오류", action: "-", prevention: "-" };
    }
  }
  return { issue, analyses };
}

// 전체 종합 및 회의록 생성
async function generateReport(date, dates, keyIssues, issueAnalyses, priority, reportType, kb) {
  const focus = REPORT_FOCUS[reportType] || REPORT_FOCUS.meeting;
  const reportTitle = REPORT_TYPES.find(r => r.id === reportType)?.label || "회의록";

  // 이슈별 분석 요약
  const issuesSummary = issueAnalyses.map((ia, i) => {
    const { issue, analyses } = ia;
    return `[이슈${i+1}] ${issue.eq} (${issue.durMin}분, ${issue.reasons?.join(",")})
문제: ${issue.prob} | 원인: ${issue.cause} | 결과: ${issue.result}
PE분석: ${analyses.Cell_PE?.analysis} | PE조치: ${analyses.Cell_PE?.action}
ME분석: ${analyses.Cell_ME?.analysis} | ME조치: ${analyses.Cell_ME?.action}
TE분석: ${analyses.Cell_TE?.analysis} | TE조치: ${analyses.Cell_TE?.action}`;
  }).join("\n\n");

  // 보고서 생성 (섹션별로 나눠서 호출)
  const dateStr = dates.length > 1 ? `${dates[0]} ~ ${dates[dates.length-1]}` : date;
  const ctx = `날짜: ${dateStr}
보고서 종류: ${reportTitle}
긴급이슈: ${priority.urgent.length}건 / 중요이슈: ${priority.important.length}건 / 일반: ${priority.normal.length}건
심층분석 대상: ${issueAnalyses.length}건

${issuesSummary}`;

  const sections = [];

  // 섹션 1: 전체 현황 요약
  try {
    await new Promise(r => setTimeout(r, 500));
    const sys1 = `AZS 배터리 공장 ${reportTitle} 작성. 한국어. JSON만:
{"heading":"1. 전체 현황 요약","items":["항목1 (구체적 수치 포함, 60자이내)","항목2","항목3","항목4"]}`;
    const raw1 = await callClaudeRaw(sys1, ctx);
    sections.push(safeJSON(raw1));
  } catch { sections.push({ heading:"1. 전체 현황 요약", items:["-"] }); }

  // 섹션 2: 긴급 이슈별 상세
  try {
    await new Promise(r => setTimeout(r, 500));
    const urgentSummary = issueAnalyses
      .filter(ia => priority.urgent.includes(ia.issue))
      .map((ia, i) => `이슈${i+1}: ${ia.issue.eq} - PE:${ia.analyses.Cell_PE?.action} ME:${ia.analyses.Cell_ME?.action} TE:${ia.analyses.Cell_TE?.action}`)
      .join(" / ");
    const sys2 = `AZS 배터리 공장 ${reportTitle} 작성. 한국어. JSON만:
{"heading":"2. 긴급 이슈 상세 분석 및 조치","items":["[설비명] 문제·원인·조치 (80자이내)","항목2","항목3"]}`;
    const raw2 = await callClaudeRaw(sys2, `${ctx}\n\n긴급이슈 분석:\n${urgentSummary}`);
    sections.push(safeJSON(raw2));
  } catch { sections.push({ heading:"2. 긴급 이슈 상세 분석 및 조치", items:["-"] }); }

  // 섹션 3: 중요 이슈별 상세
  try {
    await new Promise(r => setTimeout(r, 500));
    const importantSummary = issueAnalyses
      .filter(ia => priority.important.includes(ia.issue))
      .map((ia, i) => `이슈${i+1}: ${ia.issue.eq} - ${ia.analyses.Cell_PE?.action}`)
      .join(" / ");
    const sys3 = `AZS 배터리 공장 ${reportTitle} 작성. 한국어. JSON만:
{"heading":"3. 중요 이슈 분석 및 조치","items":["[설비명] 문제·원인·조치 (80자이내)","항목2","항목3"]}`;
    const raw3 = await callClaudeRaw(sys3, `${ctx}\n\n중요이슈 분석:\n${importantSummary}`);
    sections.push(safeJSON(raw3));
  } catch { sections.push({ heading:"3. 중요 이슈 분석 및 조치", items:["-"] }); }

  // 섹션 4: 엔지니어별 합의 액션 아이템
  try {
    await new Promise(r => setTimeout(r, 500));
    const sys4 = `AZS 배터리 공장 ${reportTitle} 작성. 한국어. JSON만:
{"heading":"4. 담당자별 액션 아이템","items":["[Cell_PE] 조치사항 (60자이내)","[Cell_ME] 조치사항 (60자이내)","[Cell_TE] 조치사항 (60자이내)","기타 조치사항"]}`;
    const raw4 = await callClaudeRaw(sys4, ctx);
    sections.push(safeJSON(raw4));
  } catch { sections.push({ heading:"4. 담당자별 액션 아이템", items:["-"] }); }

  // 섹션 5: 재발방지 및 차기 계획
  try {
    await new Promise(r => setTimeout(r, 500));
    const sys5 = `AZS 배터리 공장 ${reportTitle} 작성. 한국어. JSON만:
{"heading":"5. 재발방지 대책 및 차기 계획","items":["재발방지 대책 (60자이내)","항목2","항목3","차기 일정"]}`;
    const raw5 = await callClaudeRaw(sys5, ctx);
    sections.push(safeJSON(raw5));
  } catch { sections.push({ heading:"5. 재발방지 대책 및 차기 계획", items:["-"] }); }

  return {
    title: `${dateStr} ${reportTitle}`,
    date: dateStr,
    attendees: "Cell_PE(생산), Cell_ME(설비), Cell_TE(기술)",
    agenda: `다운타임 ${priority.urgent.length + priority.important.length + priority.normal.length}건 분석 및 대책 수립`,
    sections,
    issueAnalyses, // 건별 분석 데이터
  };
}

// ─── UI 컴포넌트 ───────────────────────────────────────────────────────────────
const ROLES = {
  Cell_PE: { label:"생산 엔지니어", color:"#3b82f6", bg:"rgba(59,130,246,0.12)", icon:"🔵" },
  Cell_ME: { label:"설비 엔지니어", color:"#f97316", bg:"rgba(249,115,22,0.12)", icon:"🟠" },
  Cell_TE: { label:"기술 엔지니어", color:"#22d3ee", bg:"rgba(34,211,238,0.12)", icon:"🟢" },
};

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

// ─── 메인 앱 ──────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep]           = useState(0);
  const [allMsgs, setAllMsgs]     = useState([]);
  const [dates, setDates]         = useState([]);
  const [selDates, setSelDates]   = useState([]); // 다중 선택
  const [reportType, setReportType] = useState("meeting");
  const [classified, setClassified] = useState(null);
  const [priority, setPriority]   = useState(null);
  const [kbStats, setKbStats]     = useState(null);
  const [issueAnalyses, setIssueAnalyses] = useState([]);
  const [minutes, setMinutes]     = useState(null);
  const [progress, setProgress]   = useState([]);
  const [running, setRunning]     = useState(false);
  const [error, setError]         = useState("");
  const [sheetSaved, setSheetSaved] = useState(false);
  const fileRef = useRef();

  // 날짜 선택 토글
  const toggleDate = (d) => {
    setSelDates(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]
    );
  };

  // 주간 요약 선택 시 해당 주 전체 자동 선택
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
    setIssueAnalyses([]); setMinutes(null); setSheetSaved(false);

    try {
      // 학습 내용 로드
      setProgress(["학습 내용 로드 중..."]);
      let kb;
      try {
        kb = await loadAllKnowledge();
        setKbStats(kb.stats);
        setProgress(p => [...p, `✅ 학습 내용 로드 완료 (PE:${kb.stats.pe}건 ME:${kb.stats.me}건 TE:${kb.stats.te}건)`]);
      } catch {
        kb = { pe:"", me:"", te:"", stats:{pe:0,me:0,te:0,failed:3} };
        setKbStats(kb.stats);
        setProgress(p => [...p, "⚠️ 학습 내용 로드 실패 — 기본 역할로 진행"]);
      }

      // 심층 분석 대상 선택
      const keyIssues = selectKeyIssues(priority);
      setProgress(p => [...p, `🔍 심층 분석 대상: ${keyIssues.length}건 (긴급 ${priority.urgent.length} + 중요 ${priority.important.length})`]);

      // 건별 심층 분석
      const analyses = [];
      for (let i = 0; i < keyIssues.length; i++) {
        const issue = keyIssues[i];
        setProgress(p => [...p, `🔵🟠🟢 [${i+1}/${keyIssues.length}] ${issue.eq} 심층 분석 중...`]);
        const result = await analyzeIssueDeep(issue, kb, reportType, i+1, keyIssues.length);
        analyses.push(result);
        setIssueAnalyses([...analyses]);
      }

      // 보고서 생성
      setProgress(p => [...p, "📄 보고서 생성 중..."]);
      const dateStr = selDates.length > 1 ? `${selDates[0]}~${selDates[selDates.length-1]}` : selDates[0];
      const report = await generateReport(dateStr, selDates, keyIssues, analyses, priority, reportType, kb);
      setMinutes(report);

      // 구글 시트 저장
      setProgress(p => [...p, "💾 구글 시트 저장 중..."]);
      const issueText = analyses.map(ia =>
        `${ia.issue.eq}(${ia.issue.durMin}분): PE-${ia.analyses.Cell_PE?.action} ME-${ia.analyses.Cell_ME?.action} TE-${ia.analyses.Cell_TE?.action}`
      ).join(" | ");

      const saved = await saveToSheets({
        date: dateStr,
        agenda: report.agenda,
        issue_summary: `긴급${priority.urgent.length}건 중요${priority.important.length}건 일반${priority.normal.length}건`,
        pe_opinion: analyses.map(ia => ia.analyses.Cell_PE?.action).join(" / "),
        me_opinion: analyses.map(ia => ia.analyses.Cell_ME?.action).join(" / "),
        te_opinion: analyses.map(ia => ia.analyses.Cell_TE?.action).join(" / "),
        discussion: issueText,
        action_items: report.sections[3]?.items?.join(" | ") || "",
        minutes_full: report.sections.map(s => `${s.heading}: ${s.items?.join(", ")}`).join(" / "),
      });
      setSheetSaved(saved);
      setStep(4); // 논의 결과 화면이 아닌 바로 문서 화면으로
      setProgress(p => [...p, "✅ 완료!"]);

    } catch(e) { setError(e.message); }
    finally { setRunning(false); }
  };

  const downloadTxt = () => {
    if (!minutes) return;
    let t = `${"═".repeat(52)}\n${minutes.title}\n${"═".repeat(52)}\n`;
    t += `일시: ${minutes.date}\n참석: ${minutes.attendees}\n안건: ${minutes.agenda}\n`;

    // 건별 심층 분석 추가
    if (issueAnalyses.length > 0) {
      t += `\n${"═".repeat(52)}\n건별 심층 분석\n${"═".repeat(52)}\n`;
      issueAnalyses.forEach((ia, i) => {
        t += `\n[이슈 ${i+1}] ${ia.issue.eq} (${ia.issue.durMin}분)\n`;
        t += `문제: ${ia.issue.prob}\n원인: ${ia.issue.cause}\n결과: ${ia.issue.result}\n`;
        t += `PE 분석: ${ia.analyses.Cell_PE?.analysis}\nPE 조치: ${ia.analyses.Cell_PE?.action}\n`;
        t += `ME 분석: ${ia.analyses.Cell_ME?.analysis}\nME 조치: ${ia.analyses.Cell_ME?.action}\n`;
        t += `TE 분석: ${ia.analyses.Cell_TE?.analysis}\nTE 조치: ${ia.analyses.Cell_TE?.action}\n`;
        t += `${"─".repeat(40)}\n`;
      });
    }

    // 보고서 섹션
    t += `\n${"═".repeat(52)}\n보고서\n${"═".repeat(52)}\n`;
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
    setIssueAnalyses([]); setMinutes(null); setProgress([]);
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
          <div style={{fontSize:13,fontWeight:800,color:"#f1f5f9"}}>AZS Cell 라인 · 이슈 분석 · 보고서</div>
          <div style={{fontSize:9,color:"#22d3ee",letterSpacing:2,fontWeight:700}}>Cell_PE · Cell_ME · Cell_TE  |  AZS</div>
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
              💡 날짜 기준: 06:00 이전 메시지는 전날 생산분으로 처리됩니다
            </div>
          </div>
        )}

        {/* STEP 1: 날짜 선택 (다중) */}
        {step===1 && (
          <div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>날짜 선택</div>
              <div style={{fontSize:12,color:"#475569"}}>
                총 {dates.length}일치 데이터 · 여러 날짜를 함께 선택할 수 있어요
              </div>
            </div>

            {/* 전체 선택/해제 */}
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

            {/* 날짜 목록 */}
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
                    marginBottom:4, transition:"all 0.15s",
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

            {/* KB 상태 */}
            {kbStats && (
              <div style={{
                background: kbStats.failed>0 ? "rgba(245,158,11,0.06)" : "rgba(52,211,153,0.06)",
                border:`1px solid ${kbStats.failed>0 ? "rgba(245,158,11,0.25)" : "rgba(52,211,153,0.25)"}`,
                borderRadius:8, padding:"8px 12px", marginBottom:12,
                fontSize:10, display:"flex", gap:16, alignItems:"center",
              }}>
                <span style={{color:kbStats.failed>0?"#f59e0b":"#34d399",fontWeight:800}}>
                  {kbStats.failed>0?"⚠️ 학습 내용 일부 로드 실패":"✅ 학습 내용 로드 완료"}
                </span>
                <span style={{color:"#3b82f6"}}>PE:{kbStats.pe}건</span>
                <span style={{color:"#f97316"}}>ME:{kbStats.me}건</span>
                <span style={{color:"#22d3ee"}}>TE:{kbStats.te}건</span>
              </div>
            )}

            {/* 우선순위 요약 */}
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

            {/* 심층분석 대상 */}
            <div style={{
              background:"rgba(167,139,250,0.06)", border:"1px solid rgba(167,139,250,0.2)",
              borderRadius:10, padding:"12px 14px", marginBottom:12,
            }}>
              <div style={{fontSize:10,color:"#a78bfa",fontWeight:800,marginBottom:8}}>
                🔍 심층 분석 대상 (최대 {MAX_ISSUES}건)
              </div>
              <div style={{fontSize:11,color:"#cbd5e1"}}>
                긴급 {priority.urgent.length}건 + 중요 {priority.important.length}건 =&nbsp;
                <span style={{color:"#a78bfa",fontWeight:800}}>
                  {Math.min(priority.urgent.length + priority.important.length, MAX_ISSUES)}건 심층 분석 예정
                </span>
              </div>
              <div style={{fontSize:9,color:"#475569",marginTop:4}}>
                예상 소요 시간: 약 {Math.ceil(Math.min(priority.urgent.length + priority.important.length, MAX_ISSUES) * 2.5 + 3)}~{Math.ceil(Math.min(priority.urgent.length + priority.important.length, MAX_ISSUES) * 3.5 + 5)}분
              </div>
            </div>

            {/* 긴급 이슈 목록 */}
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

            {/* 중요 이슈 목록 */}
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

            {/* 선택된 보고서 종류 */}
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

            {/* 진행 상황 */}
            {progress.length > 0 && (
              <div style={{
                background:"rgba(15,23,42,0.7)", border:"1px solid rgba(51,65,85,0.3)",
                borderRadius:10, padding:"14px 16px", marginBottom:14,
                maxHeight:200, overflowY:"auto",
              }}>
                {progress.map((p,i) => (
                  <div key={i} style={{
                    fontSize:11, color: p.startsWith("✅") ? "#34d399" : p.startsWith("⚠️") ? "#f59e0b" : "#94a3b8",
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
                {running?<><Spinner/>분석 진행 중...</>:"🔍 심층 분석 및 보고서 생성 →"}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: 문서 생성 완료 */}
        {step===4 && minutes && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>보고서 완성</div>
              {sheetSaved && (
                <div style={{fontSize:11,color:"#34d399"}}>✅ 구글 시트에 자동 저장 완료</div>
              )}
            </div>

            {/* 건별 심층 분석 결과 */}
            {issueAnalyses.length > 0 && (
              <div style={{marginBottom:16}}>
                <div style={{
                  fontSize:12, fontWeight:800, color:"#f1f5f9", marginBottom:10,
                  padding:"8px 14px", background:"rgba(167,139,250,0.1)",
                  border:"1px solid rgba(167,139,250,0.2)", borderRadius:8,
                }}>
                  🔍 건별 심층 분석 ({issueAnalyses.length}건)
                </div>
                {issueAnalyses.map((ia, idx) => {
                  const isPriUrgent = priority.urgent.some(u => u.eq === ia.issue.eq && u.time === ia.issue.time);
                  return (
                    <div key={idx} style={{
                      background:"rgba(15,23,42,0.7)",
                      border:`1px solid ${isPriUrgent ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
                      borderRadius:10, padding:"14px 16px", marginBottom:10,
                    }}>
                      <div style={{
                        display:"flex", justifyContent:"space-between",
                        alignItems:"center", marginBottom:10,
                      }}>
                        <div>
                          <span style={{
                            fontSize:11, fontWeight:800,
                            color: isPriUrgent ? "#ef4444" : "#f59e0b",
                          }}>
                            {isPriUrgent ? "🔴" : "🟡"} [{ia.issue.time}] {ia.issue.eq}
                          </span>
                          <span style={{fontSize:10,color:"#475569",marginLeft:8}}>
                            {ia.issue.durMin}분 · {ia.issue.prob}
                          </span>
                        </div>
                        <span style={{fontSize:9,color:"#374151"}}>
                          {ia.issue.reasons?.join(", ")}
                        </span>
                      </div>
                      {Object.entries({
                        Cell_PE: ia.analyses.Cell_PE,
                        Cell_ME: ia.analyses.Cell_ME,
                        Cell_TE: ia.analyses.Cell_TE,
                      }).map(([role, analysis]) => {
                        const r = ROLES[role];
                        return (
                          <div key={role} style={{
                            background: r.bg, borderRadius:8,
                            padding:"10px 12px", marginBottom:6,
                          }}>
                            <div style={{fontSize:10,color:r.color,fontWeight:800,marginBottom:5}}>
                              {r.icon} {r.label}
                            </div>
                            <div style={{fontSize:11,color:"#cbd5e1",lineHeight:1.6,marginBottom:4}}>
                              📊 분석: {analysis?.analysis}
                            </div>
                            <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.6,marginBottom:4}}>
                              ⚡ 조치: {analysis?.action}
                            </div>
                            <div style={{fontSize:11,color:"#94a3b8",lineHeight:1.6}}>
                              🛡️ 재발방지: {analysis?.prevention}
                            </div>
                          </div>
                        );
                      })}
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
              <button onClick={()=>{setStep(3);setMinutes(null);setIssueAnalyses([]);setProgress([]);}} style={{
                flex:1, padding:"11px", background:"transparent",
                border:"1.5px solid rgba(167,139,250,0.35)", borderRadius:8,
                color:"#a78bfa", fontSize:13, fontWeight:800, cursor:"pointer",
              }}>🔄 다시 분석</button>
            </div>
            <button onClick={()=>{setStep(1);setMinutes(null);setIssueAnalyses([]);setProgress([]);setReportType("meeting");}} style={{
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
