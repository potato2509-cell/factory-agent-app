import { useState, useRef, useEffect } from "react";

// ─── Google Sheets 연동 ───────────────────────────────────────────────────────
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE9ZyopUTxEEXpt3UjWjfgDljEiGodgbunj_UnXYc-1RlrXgNiDzAiikXoEP4g9_E/exec";

async function loadKnowledge(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_knowledge&role=${role}`);
    const data = await res.json();
    if (data.success && data.data.length > 0) {
      return data.data.map(k => `[${k.category}] ${k.content}`).join("\n");
    }
    return "";
  } catch { return ""; }
}

async function loadAllKnowledge() {
  const [pe, me, te] = await Promise.all([
    loadKnowledge("Cell_PE"),
    loadKnowledge("Cell_ME"),
    loadKnowledge("Cell_TE"),
  ]);
  return { pe, me, te };
}

async function saveToSheets(data) {
  try {
    // no-cors 모드로 POST 전송 (응답 확인 불가하지만 저장은 됨)
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_minutes", ...data }),
    });
    return true;
  } catch (e) {
    console.error("구글 시트 저장 실패:", e);
    return false;
  }
}

async function getKnowledge(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_knowledge&role=${role}`);
    const result = await res.json();
    return result.success ? result.data : [];
  } catch (e) {
    console.error("지식 베이스 로드 실패:", e);
    return [];
  }
}


// ─── Claude API (Netlify Function 경유) ──────────────────────────────────────
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

// JSON 파싱 헬퍼 - 잘린 JSON도 복구 시도
function safeParseJSON(raw) {
  // 코드블록 제거
  let cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  
  // { 시작 위치 찾기
  const s = cleaned.indexOf("{");
  if (s === -1) throw new Error("JSON 구조 없음: " + cleaned.slice(0, 100));
  cleaned = cleaned.slice(s);
  
  // 완전한 JSON 시도
  const e = cleaned.lastIndexOf("}");
  if (e !== -1) {
    try { return JSON.parse(cleaned.slice(0, e + 1)); } catch {}
  }
  
  // 잘린 경우 - 배열 닫기 시도
  let fixed = cleaned;
  // 열린 배열/객체 닫기
  let openBrackets = 0, openBraces = 0;
  let inString = false, escape = false;
  for (const ch of fixed) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
  }
  // 마지막 불완전한 문자열 제거
  fixed = fixed.replace(/,\s*"[^"]*$/, "");
  fixed = fixed.replace(/,\s*\{[^}]*$/, "");
  // 닫기
  for (let i = 0; i < openBrackets; i++) fixed += "]";
  for (let i = 0; i < openBraces; i++) fixed += "}";
  
  try { return JSON.parse(fixed); }
  catch (err) { throw new Error("파싱 실패: " + err.message + "\n원문: " + cleaned.slice(0, 200)); }
}

// ─── WhatsApp 파서 ────────────────────────────────────────────────────────────
function parseWhatsApp(text) {
  const lines = text.split("\n");
  const msgRe = /^(\d{2}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+-\s+([^:]+):\s*(.*)/;
  const msgs = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(msgRe);
    if (m) {
      if (cur) msgs.push(cur);
      cur = { date: m[1], time: m[2], sender: m[3].trim(), text: m[4] };
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

function getUniqueDates(msgs) {
  return [...new Set(msgs.map(m => m.date))].sort((a, b) => {
    const pa = a.split("/").map(Number);
    const pb = b.split("/").map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
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

// 핵심 이슈만 짧게 추출 - *bold* 형식 처리
function extractField(text, fieldName) {
  const re = new RegExp(String.raw`\*?${fieldName}\*?[:\s]+\*?\n?-?\s*([^\n]+)`, "i");
  return text.match(re)?.[1]?.replace(/\*/g, "").trim() || "";
}

function buildShortSummary(date, classified) {
  const { downtime, equipment } = classified;
  let s = `날짜: ${date}\n`;
  s += `다운타임: ${downtime.length}건, 설비경고: ${equipment.length}건\n\n`;

  downtime.slice(0, 5).forEach((d, i) => {
    const eq   = extractField(d.text, "Equipment");
    const dur  = extractField(d.text, "Duration");
    const prob = extractField(d.text, "Problem");
    const cause= extractField(d.text, "Cause");
    const pic  = extractField(d.text, "PIC");
    s += `[다운타임${i+1}] 설비:${eq} / ${dur} / 문제:${prob} / 원인:${cause} / 담당:${pic}\n`;
  });

  equipment.slice(0, 3).forEach((e, i) => {
    s += `[경고${i+1}] ${e.text.slice(0, 80)}\n`;
  });

  return s.slice(0, 800);
}

// AZS Cell 라인 전용 에이전트
const ROLES = {
  Cell_PE: { label: "생산 엔지니어", color: "#3b82f6", bg: "rgba(59,130,246,0.12)", icon: "🔵",
    focus: "Cell 라인 생산 목표 달성, 납기, 공정 안정화, OEE 관리" },
  Cell_ME: { label: "설비 엔지니어", color: "#f97316", bg: "rgba(249,115,22,0.12)", icon: "🟠",
    focus: "Cell 설비 가동률, 예방보전, 고장 원인, MTBF/MTTR 관리" },
  Cell_TE: { label: "기술 엔지니어", color: "#22d3ee", bg: "rgba(34,211,238,0.12)", icon: "🟢",
    focus: "Cell 공정 기술, 품질 원인 분석, 조건 최적화, 재발 방지" },
};

// ─── API 호출 함수들 (각각 독립적으로 짧게) ──────────────────────────────────

// Step A: 이슈 요약만
async function fetchIssueSummary(shortSummary) {
  const sys = `AZS Cell 라인 현장 데이터 요약. 한국어. 아래 JSON만 출력. 각 문자열은 50자 이내.
{"issue_summary":"핵심요약50자이내","top_issues":["이슈1(30자이내)","이슈2(30자이내)","이슈3(30자이내)"]}`;
  const raw = await callClaudeRaw(sys, `다음 AZS Cell 라인 현장 데이터의 핵심만 요약하세요:\n${shortSummary}`);
  return safeParseJSON(raw);
}

// Step B: Cell_PE 의견
async function fetchPEView(shortSummary, issueSummary, peKB="") {
  const kbText = peKB ? `\n\n[Cell_PE 학습 내용]\n${peKB}` : "";
  const sys = `당신은 AZS 배터리 공장 Cell 라인 생산 엔지니어(Cell_PE). 한국어로 답변.${kbText}
JSON만 출력: {"msg":"생산 관점 의견 (60자이내)","action":"Cell_PE 할 일 (30자이내)"}`;
  const raw = await callClaudeRaw(sys,
    `이슈: ${issueSummary}\n현장: ${shortSummary}\nCell_PE 관점으로 의견과 액션 아이템을 제시하세요.`);
  return safeParseJSON(raw);
}

// Step C: Cell_ME 의견
async function fetchMEView(shortSummary, issueSummary, meKB="") {
  const kbText = meKB ? `\n\n[Cell_ME 학습 내용]\n${meKB}` : "";
  const sys = `당신은 AZS 배터리 공장 Cell 라인 설비 엔지니어(Cell_ME). 한국어로 답변.${kbText}
JSON만 출력: {"msg":"설비 관점 의견 (60자이내)","action":"Cell_ME 할 일 (30자이내)"}`;
  const raw = await callClaudeRaw(sys,
    `이슈: ${issueSummary}\n현장: ${shortSummary}\nCell_ME 관점으로 의견과 액션 아이템을 제시하세요.`);
  return safeParseJSON(raw);
}

// Step D: Cell_TE 의견
async function fetchTEView(shortSummary, issueSummary, teKB="") {
  const kbText = teKB ? `\n\n[Cell_TE 학습 내용]\n${teKB}` : "";
  const sys = `당신은 AZS 배터리 공장 Cell 라인 기술 엔지니어(Cell_TE). 한국어로 답변.${kbText}
JSON만 출력: {"msg":"기술 관점 의견 (60자이내)","action":"Cell_TE 할 일 (30자이내)"}`;
  const raw = await callClaudeRaw(sys,
    `이슈: ${issueSummary}\n현장: ${shortSummary}\nCell_TE 관점으로 의견과 액션 아이템을 제시하세요.`);
  return safeParseJSON(raw);
}

// Step E: 합의 및 추가 논의
async function fetchConsensus(issueSummary, pe, me, te) {
  const sys = `AZS Cell 라인 엔지니어 3자 논의 조율자. 한국어.
JSON만 출력: {"pe_reply":"Cell_PE 추가 발언(40자이내)","me_reply":"Cell_ME 추가 발언(40자이내)","te_reply":"Cell_TE 추가 발언(40자이내)","next_meeting":"차기 일정"}`;
  const raw = await callClaudeRaw(sys,
    `이슈: ${issueSummary}\nCell_PE의견: ${pe.msg}\nCell_ME의견: ${me.msg}\nCell_TE의견: ${te.msg}\n합의점을 도출하세요.`);
  return safeParseJSON(raw);
}

// Step F: 회의록
async function fetchMinutesSection(prompt, sectionNum) {
  const sysMap = {
    1: `JSON만: {"heading":"1. 이슈 개요","items":["항목1(40자이내)","항목2(40자이내)","항목3(40자이내)"]}`,
    2: `JSON만: {"heading":"2. 엔지니어별 분석","items":["PE: 내용(40자)","ME: 내용(40자)","TE: 내용(40자)"]}`,
    3: `JSON만: {"heading":"3. 결정 사항","items":["결정1(40자)","결정2(40자)"]}`,
    4: `JSON만: {"heading":"4. 액션 아이템","items":["PE: 액션(30자)","ME: 액션(30자)","TE: 액션(30자)"]}`,
    5: `JSON만: {"heading":"5. 차기 일정","items":["일정내용(40자)"]}`,
  };
  const raw = await callClaudeRaw(sysMap[sectionNum], prompt);
  return safeParseJSON(raw);
}

async function fetchMinutes(date, shortSummary, issueSummary, pe, me, te, consensus) {
  const ctx = `날짜:${date} | 이슈:${issueSummary} | PE:${pe.msg}/${pe.action} | ME:${me.msg}/${me.action} | TE:${te.msg}/${te.action}`;
  
  // 섹션을 하나씩 생성
  const sections = [];
  for (let i = 1; i <= 5; i++) {
    try {
      const sec = await fetchMinutesSection(ctx, i);
      sections.push(sec);
    } catch {
      // 실패한 섹션은 기본값
      const headings = ["1. 이슈 개요","2. 엔지니어별 분석","3. 결정 사항","4. 액션 아이템","5. 차기 일정"];
      sections.push({ heading: headings[i-1], items: ["-"] });
    }
  }
  
  return {
    title: `${date} 생산 현황 회의록`,
    date,
    attendees: "PE(생산 엔지니어), ME(설비 엔지니어), TE(기술 엔지니어)",
    agenda: `${date} 다운타임 ${shortSummary.match(/다운타임: (\d+)건/)?.[1]||""}건 분석 및 대책`,
    sections,
  };
}



// ─── UI 컴포넌트 ──────────────────────────────────────────────────────────────
function Spinner() {
  return <span style={{
    display:"inline-block",width:13,height:13,
    border:"2px solid rgba(255,255,255,0.2)",
    borderTop:"2px solid currentColor",borderRadius:"50%",
    animation:"spin 0.7s linear infinite",
  }}/>;
}

function ChatBubble({ role, msg, idx }) {
  const r = ROLES[role];
  const isRight = role === "ME";
  return (
    <div style={{
      display:"flex",gap:8,marginBottom:12,
      flexDirection:isRight?"row-reverse":"row",
      animation:`fadeUp 0.2s ease ${idx*0.06}s both`,
    }}>
      <div style={{
        width:30,height:30,borderRadius:"50%",flexShrink:0,
        background:r.bg,border:`1.5px solid ${r.color}44`,
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:14,marginTop:2,
      }}>{r.icon}</div>
      <div style={{maxWidth:"76%"}}>
        <div style={{fontSize:9.5,color:r.color,fontWeight:800,marginBottom:3,
          textAlign:isRight?"right":"left"}}>{r.label}</div>
        <div style={{
          background:r.bg,border:`1px solid ${r.color}28`,
          borderRadius:isRight?"12px 3px 12px 12px":"3px 12px 12px 12px",
          padding:"9px 13px",fontSize:12.5,color:"#dde6f0",lineHeight:1.75,
        }}>{msg}</div>
      </div>
    </div>
  );
}

function ProgressStep({ label, done, active }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
      <div style={{
        width:20,height:20,borderRadius:"50%",flexShrink:0,
        background:done?"#34d399":active?"#3b82f6":"rgba(51,65,85,0.4)",
        display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:10,color:"#fff",fontWeight:800,
      }}>{done?"✓":active?<Spinner/>:""}</div>
      <span style={{fontSize:12,color:done?"#34d399":active?"#93c5fd":"#374151"}}>{label}</span>
    </div>
  );
}

// ─── 메인 ────────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep]       = useState(0);
  const [allMsgs, setAllMsgs] = useState([]);
  const [dates, setDates]     = useState([]);
  const [selDate, setSelDate] = useState("");
  const [classified, setClassified] = useState(null);
  const [shortSummary, setShortSummary] = useState("");

  // 논의 결과
  const [issueSummary, setIssueSummary] = useState(null);
  const [peView, setPeView]   = useState(null);
  const [meView, setMeView]   = useState(null);
  const [teView, setTeView]   = useState(null);
  const [consensus, setConsensus] = useState(null);
  const [minutes, setMinutes] = useState(null);

  // 진행 상태
  const [progress, setProgress] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError]     = useState("");
  const fileRef = useRef();
  const chatRef = useRef();

  useEffect(() => { chatRef.current?.scrollIntoView({behavior:"smooth"}); }, [consensus]);

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const msgs = parseWhatsApp(text);
    const ds = getUniqueDates(msgs);
    setAllMsgs(msgs);
    setDates(ds);
    setSelDate(ds[ds.length - 1] || "");
    setStep(1);
  };

  const handleDateSelect = () => {
    const dayMsgs = allMsgs.filter(m => m.date === selDate);
    const cl = classifyMessages(dayMsgs);
    const sm = buildShortSummary(selDate, cl);
    setClassified(cl);
    setShortSummary(sm);
    setStep(2);
    setError("");
    setIssueSummary(null); setPeView(null); setMeView(null);
    setTeView(null); setConsensus(null); setMinutes(null);
    setProgress([]);
  };

  const runDiscussion = async () => {
    setRunning(true); setError(""); setProgress([]);
    let iss, pe, me, te, cons;
    try {
      setProgress(["학습 내용 로드 중..."]);
      const kb = await loadAllKnowledge();

      setProgress(p => [...p, "이슈 분석 중..."]);
      iss = await fetchIssueSummary(shortSummary);
      setIssueSummary(iss);

      setProgress(p => [...p, "Cell_PE 의견 생성 중..."]);
      pe = await fetchPEView(shortSummary, iss.issue_summary, kb.pe);
      setPeView(pe);

      setProgress(p => [...p, "Cell_ME 의견 생성 중..."]);
      me = await fetchMEView(shortSummary, iss.issue_summary, kb.me);
      setMeView(me);

      setProgress(p => [...p, "Cell_TE 의견 생성 중..."]);
      te = await fetchTEView(shortSummary, iss.issue_summary, kb.te);
      setTeView(te);

      setProgress(p => [...p, "합의점 도출 중..."]);
      cons = await fetchConsensus(iss.issue_summary, pe, me, te);
      setConsensus(cons);

      setStep(3);
    } catch(e) { setError(e.message); }
    finally { setRunning(false); }
  };

  const [sheetSaved, setSheetSaved] = useState(false);

  const runMinutes = async () => {
    setRunning(true); setError(""); setSheetSaved(false);
    try {
      const mins = await fetchMinutes(
        selDate, shortSummary, issueSummary.issue_summary,
        peView, meView, teView, consensus
      );
      setMinutes(mins);
      setStep(4);

      // 구글 시트 자동 저장
      const discussion_text = [
        `PE: ${peView.msg}`,
        `ME: ${meView.msg}`,
        `TE: ${teView.msg}`,
        `PE: ${consensus.pe_reply}`,
        `ME: ${consensus.me_reply}`,
        `TE: ${consensus.te_reply}`,
      ].join(" | ");

      const action_text = [
        `PE: ${peView.action}`,
        `ME: ${meView.action}`,
        `TE: ${teView.action}`,
      ].join(" | ");

      const minutes_full = (mins.sections || [])
        .map(s => s.heading + ": " + (s.items || []).join(", "))
        .join(" / ");

      const saved = await saveToSheets({
        date: selDate,
        agenda: mins.agenda || "",
        issue_summary: issueSummary.issue_summary || "",
        pe_opinion: `${peView.msg} / 액션: ${peView.action}`,
        me_opinion: `${meView.msg} / 액션: ${meView.action}`,
        te_opinion: `${teView.msg} / 액션: ${teView.action}`,
        discussion: discussion_text,
        action_items: action_text,
        minutes_full,
      });
      setSheetSaved(saved);
    } catch(e) { setError(e.message); }
    finally { setRunning(false); }
  };

  const downloadTxt = () => {
    if (!minutes) return;
    let t = `${"═".repeat(50)}\n${minutes.title}\n${"═".repeat(50)}\n`;
    t += `일시: ${minutes.date}\n참석: ${minutes.attendees}\n안건: ${minutes.agenda}\n`;
    for (const s of minutes.sections||[]) {
      t += `\n${s.heading}\n${"─".repeat(28)}\n`;
      for (const item of s.items||[]) t += `  · ${item}\n`;
    }
    t += `\n${"─".repeat(50)}\n※ AI 생성 회의록`;
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([t], {type:"text/plain;charset=utf-8"})),
      download:`${minutes.title}.txt`,
    }).click();
  };

  const STEPS = ["① 업로드","② 날짜","③ 논의","④ 회의록"];

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(150deg,#03060d,#060d1c 55%,#040810)",
      fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
      color:"#e2e8f0",
    }}>
      {/* Header */}
      <div style={{
        background:"rgba(3,6,13,0.96)",backdropFilter:"blur(12px)",
        borderBottom:"1px solid rgba(34,211,238,0.12)",
        padding:"12px 20px",position:"sticky",top:0,zIndex:100,
        display:"flex",alignItems:"center",gap:12,
      }}>
        <div style={{
          width:34,height:34,borderRadius:8,
          background:"linear-gradient(135deg,#3b82f6,#22d3ee)",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,
        }}>🏭</div>
        <div>
          <div style={{fontSize:13,fontWeight:800,color:"#f1f5f9"}}>AZS Cell 라인 · 이슈 분석 · 회의록</div>
          <div style={{fontSize:9,color:"#22d3ee",letterSpacing:2,fontWeight:700}}>Cell_PE · Cell_ME · Cell_TE  |  AZS</div>
        </div>
        {step>0 && (
          <button onClick={()=>{setStep(0);setAllMsgs([]);}} style={{
            marginLeft:"auto",padding:"5px 12px",
            background:"rgba(51,65,85,0.4)",border:"1px solid rgba(51,65,85,0.5)",
            borderRadius:6,color:"#64748b",fontSize:11,cursor:"pointer",
          }}>처음으로</button>
        )}
      </div>

      {/* Step bar */}
      <div style={{display:"flex",borderBottom:"1px solid rgba(51,65,85,0.3)",background:"rgba(3,6,13,0.85)"}}>
        {STEPS.map((s,i)=>(
          <div key={i} style={{
            flex:1,padding:"10px 6px",textAlign:"center",
            background:step===i?"rgba(34,211,238,0.08)":"transparent",
            borderBottom:`2px solid ${step===i?"#22d3ee":step>i?"#34d399":"transparent"}`,
            fontSize:10,fontWeight:800,
            color:step===i?"#22d3ee":step>i?"#34d399":"#374151",
          }}>{s}</div>
        ))}
      </div>

      <div style={{maxWidth:700,margin:"0 auto",padding:"24px 18px 60px"}}>

        {/* STEP 0: 업로드 */}
        {step===0 && (
          <div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>WhatsApp 채팅 파일 업로드</div>
              <div style={{fontSize:12,color:"#475569"}}>WhatsApp → 채팅 내보내기 → txt 파일</div>
            </div>
            <div onClick={()=>fileRef.current?.click()} style={{
              border:"2px dashed rgba(34,211,238,0.3)",borderRadius:12,
              padding:"48px 20px",textAlign:"center",cursor:"pointer",
              background:"rgba(34,211,238,0.03)",marginBottom:20,
            }}>
              <input ref={fileRef} type="file" accept=".txt" onChange={handleFile} style={{display:"none"}}/>
              <div style={{fontSize:40,marginBottom:12}}>📂</div>
              <div style={{fontSize:14,color:"#22d3ee",fontWeight:700}}>클릭하여 txt 파일 선택</div>
              <div style={{fontSize:11,color:"#374151",marginTop:4}}>WhatsApp 채팅 내보내기 (.txt)</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              {Object.entries(ROLES).map(([k,r])=>(
                <div key={k} style={{flex:1,background:r.bg,border:`1px solid ${r.color}28`,borderRadius:10,padding:"12px"}}>
                  <div style={{fontSize:20,marginBottom:4}}>{r.icon}</div>
                  <div style={{fontSize:11,fontWeight:800,color:r.color,marginBottom:2}}>{k}</div>
                  <div style={{fontSize:10,color:"#475569"}}>{r.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 1: 날짜 */}
        {step===1 && (
          <div>
            <div style={{marginBottom:20}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>날짜 선택</div>
              <div style={{fontSize:12,color:"#475569"}}>총 {dates.length}일치 데이터</div>
            </div>
            <div style={{fontSize:10,color:"#475569",fontWeight:800,letterSpacing:1.2,marginBottom:6}}>날짜</div>
            <select value={selDate} onChange={e=>setSelDate(e.target.value)} style={{
              width:"100%",background:"rgba(6,10,18,0.9)",
              border:"1.5px solid rgba(34,211,238,0.25)",borderRadius:8,
              color:"#e2e8f0",padding:"10px 13px",fontSize:13,outline:"none",marginBottom:20,
            }}>
              {dates.map(d=>(
                <option key={d} value={d} style={{background:"#0f172a"}}>
                  {d} ({allMsgs.filter(m=>m.date===d).length}건)
                </option>
              ))}
            </select>
            <button onClick={handleDateSelect} style={{
              width:"100%",padding:"12px",
              background:"linear-gradient(135deg,#3b82f6,#22d3ee)",
              border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",
            }}>분석 시작 →</button>
          </div>
        )}

        {/* STEP 2: 이슈 확인 + 논의 */}
        {step===2 && classified && (
          <div>
            <div style={{marginBottom:16}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>{selDate} 이슈 현황</div>
            </div>

            {/* 통계 */}
            <div style={{display:"flex",gap:10,marginBottom:16}}>
              {[
                {label:"다운타임",count:classified.downtime.length,color:"#ef4444",icon:"⚡"},
                {label:"설비 경고",count:classified.equipment.length,color:"#f97316",icon:"⚠️"},
                {label:"일반 메시지",count:classified.general.length,color:"#22d3ee",icon:"💬"},
              ].map(s=>(
                <div key={s.label} style={{
                  flex:1,background:"rgba(15,23,42,0.7)",
                  border:`1px solid ${s.color}30`,borderRadius:10,padding:"12px",textAlign:"center",
                }}>
                  <div style={{fontSize:22,marginBottom:4}}>{s.icon}</div>
                  <div style={{fontSize:20,fontWeight:800,color:s.color}}>{s.count}</div>
                  <div style={{fontSize:10,color:"#475569"}}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* 다운타임 상위 3건 */}
            {classified.downtime.slice(0,3).map((d,i)=>{
              const eq = extractField(d.text,"Equipment");
              const prob = extractField(d.text,"Problem");
              const dur = extractField(d.text,"Duration");
              return (
                <div key={i} style={{
                  background:"rgba(239,68,68,0.05)",border:"1px solid rgba(239,68,68,0.2)",
                  borderRadius:8,padding:"10px 12px",marginBottom:8,fontSize:11,
                }}>
                  <span style={{color:"#ef4444",fontWeight:800}}>⚡ [{d.time}] {eq}</span>
                  <span style={{color:"#94a3b8"}}> · {dur} · {prob}</span>
                </div>
              );
            })}
            {classified.downtime.length > 3 && (
              <div style={{fontSize:11,color:"#374151",marginBottom:12}}>
                외 {classified.downtime.length-3}건 추가
              </div>
            )}

            {/* 진행 상태 */}
            {progress.length > 0 && (
              <div style={{
                background:"rgba(15,23,42,0.7)",border:"1px solid rgba(51,65,85,0.3)",
                borderRadius:10,padding:"14px 16px",marginBottom:14,
              }}>
                {["학습 내용 로드 중...","이슈 분석 중...","Cell_PE 의견 생성 중...","Cell_ME 의견 생성 중...","Cell_TE 의견 생성 중...","합의점 도출 중..."].map((label,i)=>(
                  <ProgressStep key={i} label={label}
                    done={progress.length > i+1 || (!running && progress.length > i)}
                    active={running && progress.length === i+1}
                  />
                ))}
              </div>
            )}

            {error && (
              <div style={{
                padding:"10px 14px",background:"rgba(239,68,68,0.08)",
                border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,
                fontSize:11,color:"#fca5a5",marginBottom:12,
                wordBreak:"break-all",lineHeight:1.6,whiteSpace:"pre-wrap",
              }}>❌ {error}</div>
            )}

            <button onClick={runDiscussion} disabled={running} style={{
              width:"100%",padding:"12px",
              background:running?"rgba(51,65,85,0.3)":"linear-gradient(135deg,#f97316,#fb923c)",
              border:"none",borderRadius:8,color:running?"#374151":"#fff",
              fontSize:13,fontWeight:800,cursor:running?"not-allowed":"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",gap:8,
            }}>
              {running?<><Spinner/>진행 중...</>:"🤝 3자 엔지니어 논의 시작 →"}
            </button>
          </div>
        )}

        {/* STEP 3: 논의 결과 */}
        {step===3 && peView && meView && teView && consensus && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:8}}>엔지니어 논의</div>
              <div style={{
                background:"rgba(239,68,68,0.07)",border:"1px solid rgba(239,68,68,0.2)",
                borderRadius:8,padding:"9px 13px",fontSize:12,color:"#fca5a5",
              }}>
                <span style={{color:"#ef4444",fontWeight:800}}>⚡ </span>
                {issueSummary?.issue_summary}
              </div>
            </div>

            {/* 채팅 형식 논의 */}
            <div style={{
              background:"rgba(4,8,16,0.7)",border:"1px solid rgba(51,65,85,0.3)",
              borderRadius:12,padding:"16px 14px",marginBottom:14,
            }}>
              <ChatBubble role="PE" msg={peView.msg} idx={0}/>
              <ChatBubble role="ME" msg={meView.msg} idx={1}/>
              <ChatBubble role="TE" msg={teView.msg} idx={2}/>
              <ChatBubble role="PE" msg={consensus.pe_reply} idx={3}/>
              <ChatBubble role="ME" msg={consensus.me_reply} idx={4}/>
              <ChatBubble role="TE" msg={consensus.te_reply} idx={5}/>
              <div ref={chatRef}/>
            </div>

            {/* 액션 아이템 */}
            <div style={{
              background:"rgba(52,211,153,0.05)",border:"1px solid rgba(52,211,153,0.2)",
              borderRadius:10,padding:"13px 15px",marginBottom:14,
            }}>
              <div style={{fontSize:10,color:"#34d399",fontWeight:800,marginBottom:10}}>✅ 액션 아이템</div>
              {[
                {role:"PE",action:peView.action},
                {role:"ME",action:meView.action},
                {role:"TE",action:teView.action},
              ].map((a,i)=>{
                const r=ROLES[a.role];
                return (
                  <div key={i} style={{display:"flex",gap:10,marginBottom:7,alignItems:"flex-start"}}>
                    <span style={{
                      background:r.bg,border:`1px solid ${r.color}40`,color:r.color,
                      borderRadius:4,padding:"1px 7px",fontSize:10,fontWeight:800,flexShrink:0,
                    }}>{a.role}</span>
                    <span style={{fontSize:12.5,color:"#cbd5e1",lineHeight:1.6}}>{a.action}</span>
                  </div>
                );
              })}
              {consensus.next_meeting && (
                <div style={{marginTop:8,fontSize:11,color:"#475569"}}>📅 {consensus.next_meeting}</div>
              )}
            </div>

            {error && (
              <div style={{
                padding:"10px 14px",background:"rgba(239,68,68,0.08)",
                border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,
                fontSize:11,color:"#fca5a5",marginBottom:12,wordBreak:"break-all",
              }}>❌ {error}</div>
            )}

            <button onClick={runMinutes} disabled={running} style={{
              width:"100%",padding:"12px",
              background:running?"rgba(51,65,85,0.3)":"linear-gradient(135deg,#a78bfa,#7c3aed)",
              border:"none",borderRadius:8,color:running?"#374151":"#fff",
              fontSize:13,fontWeight:800,cursor:running?"not-allowed":"pointer",
              display:"flex",alignItems:"center",justifyContent:"center",gap:8,
            }}>
              {running?<><Spinner/>회의록 작성 중...</>:"📄 회의록 생성 →"}
            </button>
          </div>
        )}

        {/* STEP 4: 회의록 */}
        {step===4 && minutes && (
          <div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:17,fontWeight:800,color:"#f1f5f9",marginBottom:4}}>회의록 완성</div>
            </div>
            <div style={{
              background:"rgba(248,250,252,0.97)",borderRadius:12,
              color:"#1e293b",padding:"28px 32px",marginBottom:14,
              boxShadow:"0 20px 60px rgba(0,0,0,0.5)",
              fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
            }}>
              <div style={{borderBottom:"3px solid #1d4ed8",paddingBottom:14,marginBottom:18}}>
                <div style={{fontSize:9,letterSpacing:3,color:"#3b82f6",fontWeight:800,marginBottom:5}}>MEETING MINUTES</div>
                <div style={{fontSize:18,fontWeight:900,color:"#0f172a",marginBottom:8}}>{minutes.title}</div>
                <div style={{display:"flex",gap:16,fontSize:11,color:"#64748b",flexWrap:"wrap"}}>
                  <span>📅 {minutes.date}</span>
                  <span>👥 {minutes.attendees}</span>
                </div>
                <div style={{marginTop:6,fontSize:11,color:"#475569"}}>
                  <span style={{fontWeight:700}}>안건: </span>{minutes.agenda}
                </div>
              </div>
              {(minutes.sections||[]).map((sec,i)=>(
                <div key={i} style={{marginBottom:16}}>
                  <div style={{
                    fontSize:11,fontWeight:800,color:"#1d4ed8",
                    background:"#dbeafe",padding:"4px 10px",
                    borderRadius:5,marginBottom:8,display:"inline-block",
                  }}>{sec.heading}</div>
                  <ul style={{margin:0,padding:0,listStyle:"none"}}>
                    {(sec.items||[]).map((item,j)=>(
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
              <div style={{borderTop:"1px solid #e2e8f0",paddingTop:10,marginTop:4,fontSize:10,color:"#94a3b8",textAlign:"right"}}>
                AI 생성 회의록 · {new Date().toLocaleString("ko-KR")}
              </div>
            </div>
            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <button onClick={downloadTxt} style={{
                flex:1,padding:"11px",
                background:"linear-gradient(135deg,#3b82f6,#22d3ee)",
                border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer",
              }}>📥 TXT 다운로드</button>
              <button onClick={()=>{setStep(1);setMinutes(null);setDiscussion(null);}} style={{
                flex:1,padding:"11px",background:"transparent",
                border:"1.5px solid rgba(59,130,246,0.35)",borderRadius:8,
                color:"#93c5fd",fontSize:13,fontWeight:800,cursor:"pointer",
              }}>🔄 다른 날짜</button>
            </div>
            {sheetSaved ? (
              <div style={{
                padding:"10px 14px",background:"rgba(52,211,153,0.08)",
                border:"1px solid rgba(52,211,153,0.25)",borderRadius:8,
                fontSize:11,color:"#34d399",lineHeight:1.6,
              }}>
                ✅ 구글 시트에 자동 저장 완료 — Meeting_Minutes 탭에서 확인하세요
              </div>
            ) : (
              <div style={{
                padding:"10px 14px",background:"rgba(245,158,11,0.06)",
                border:"1px solid rgba(245,158,11,0.2)",borderRadius:8,
                fontSize:11,color:"#fbbf24",lineHeight:1.6,
              }}>
                ⏳ 구글 시트 저장 중... 잠시 후 확인하세요
              </div>
            )}
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
