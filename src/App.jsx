import { useState, useRef, useEffect } from "react";

// ─── 설정 ─────────────────────────────────────────────────────────────────────
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwE9ZyopUTxEEXpt3UjWjfgDljEiGodgbunj_UnXYc-1RlrXgNiDzAiikXoEP4g9_E/exec";

const ROLE_CONFIG = {
  Cell_PE: { label: "생산 엔지니어", line: "Cell", color: "#3b82f6", bg: "rgba(59,130,246,0.12)", icon: "🔵",
    focus: "Cell 라인 생산 목표 달성, 납기, 공정 안정화, OEE 관리" },
  Cell_ME: { label: "설비 엔지니어", line: "Cell", color: "#f97316", bg: "rgba(249,115,22,0.12)", icon: "🟠",
    focus: "Cell 설비 가동률, 예방보전, 고장 원인, MTBF/MTTR 관리" },
  Cell_TE: { label: "기술 엔지니어", line: "Cell", color: "#22d3ee", bg: "rgba(34,211,238,0.12)", icon: "🟢",
    focus: "Cell 공정 기술, 품질 원인 분석, 조건 최적화, 재발 방지" },
  Elec_PE: { label: "생산 엔지니어", line: "Elec", color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "🟣",
    focus: "Elec 라인 생산 목표 달성, 납기, 공정 안정화, OEE 관리" },
  Elec_ME: { label: "설비 엔지니어", line: "Elec", color: "#f43f5e", bg: "rgba(244,63,94,0.12)", icon: "🔴",
    focus: "Elec 설비 가동률, 예방보전, 고장 원인, MTBF/MTTR 관리" },
  Elec_TE: { label: "기술 엔지니어", line: "Elec", color: "#34d399", bg: "rgba(52,211,153,0.12)", icon: "🟩",
    focus: "Elec 공정 기술, 품질 원인 분석, 조건 최적화, 재발 방지" },
  FA: { label: "FA 엔지니어", line: "공통", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: "🟡",
    focus: "공정 간 자동 반송 시스템 (C/V, Stocker, OHT, AGV) 운영·정비, WIP 흐름 관리" },
  Vision: { label: "비전 엔지니어", line: "공통", color: "#ec4899", bg: "rgba(236,72,153,0.12)", icon: "🩷",
    focus: "외관 검사 시스템, 불량 이미지 분석, 비전 알고리즘, 검사 기준 관리" },
};

// 대시보드용 8개 에이전트 메타
const DASHBOARD_AGENT_META = {
  Cell_PE: { line: "Cell", role: "생산", color: "#3b82f6" },
  Cell_ME: { line: "Cell", role: "설비", color: "#f97316" },
  Cell_TE: { line: "Cell", role: "기술", color: "#22d3ee" },
  Elec_PE: { line: "Elec", role: "생산", color: "#a78bfa" },
  Elec_ME: { line: "Elec", role: "설비", color: "#f43f5e" },
  Elec_TE: { line: "Elec", role: "기술", color: "#34d399" },
  FA: { line: "공통", role: "FA", color: "#f59e0b" },
  Vision: { line: "공통", role: "비전", color: "#ec4899" },
};

const LINE_COLORS = {
  Cell: "#0ea5e9",
  Elec: "#f43f5e",
  공통: "#10b981",
};

// 학습 수준 평가 - 절대평가 목표값 (보수적 기준, 2달 학습 가정)
// 각 지표별로 이 목표값에 도달하면 100점
const TARGET_VALUES = {
  itemCount: 300,        // 학습 항목 수 (row)
  contentLength: 80000,  // 학습 내용 총 글자수
  categoryCount: 5,      // 카테고리 다양성 (전체 5종 모두 사용)
  correctionCount: 60,   // 교정 사례 수
  recentRate: 70,        // 최신성 (최근 7일 내 업데이트 비율 70%)
};

// URL 파라미터에서 role 읽기
function getRole() {
  // search 방식과 hash 방식 모두 지원
  const search = window.location.search || window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(search);
  const r = params.get("role")?.toUpperCase();
  // Cell_PE 형식 처리 (대소문자 혼용)
  const roleKey = Object.keys(ROLE_CONFIG).find(k => k.toUpperCase() === r);
  return roleKey || null;
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function callClaude(system, userMsg) {
  const res = await fetch("/.netlify/functions/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userMsg, max_tokens: 1000 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.content || []).map(i => i.text || "").join("").trim();
}

// Vision API 호출
async function callClaudeVision(system, userMsg, imageBase64, mediaType) {
  const res = await fetch("/.netlify/functions/claude-vision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userMsg, imageBase64, mediaType }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.content || []).map(i => i.text || "").join("").trim();
}

// 파일을 Base64로 변환 (이미지인 경우 자동 압축)
// 긴 변이 1600px 넘으면 비율 유지하며 축소, JPEG 90% 품질로 재인코딩
function fileToBase64(file) {
  // 이미지가 아니면 원본 그대로 base64 변환
  if (!file.type.startsWith("image/")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 이미지 압축 처리
  return new Promise((resolve, reject) => {
    const MAX_DIMENSION = 1600;
    const QUALITY = 0.9;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          const longSide = Math.max(width, height);

          // 긴 변이 MAX 초과 시 축소
          if (longSide > MAX_DIMENSION) {
            const scale = MAX_DIMENSION / longSide;
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          // JPEG로 재인코딩 (PNG도 JPEG로 변환되어 용량 줄어듦)
          const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
          resolve(dataUrl.split(",")[1]);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("이미지 로드 실패"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
}

// 압축 후 base64 데이터 크기를 KB로 추정 (UI 표시용)
function estimateBase64Size(base64) {
  return Math.round((base64.length * 3 / 4) / 1024);
}

// PDF 텍스트 추출 (간단 방식)
async function extractTextFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => resolve("");
    reader.readAsText(file, "utf-8");
  });
}

// ─── PDF 처리 (Step 5-B) ────────────────────────────────────────────────────────
// pdfjs를 CDN에서 동적 로드 (package.json 의존성 없이)
// 한 번만 로드하고 캐시
let _pdfjsLib = null;
async function loadPdfjs() {
  if (_pdfjsLib) return _pdfjsLib;
  // 이미 로드되어 있으면 사용
  if (window.pdfjsLib) {
    _pdfjsLib = window.pdfjsLib;
    return _pdfjsLib;
  }
  // CDN에서 로드
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      // worker도 CDN으로 설정
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      _pdfjsLib = window.pdfjsLib;
      resolve(_pdfjsLib);
    };
    script.onerror = () => reject(new Error("pdfjs 로드 실패"));
    document.head.appendChild(script);
  });
}

// PDF 파일에서 페이지 수 + PDF 객체 반환
async function loadPdfDocument(file) {
  const pdfjs = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  return pdf; // pdf.numPages, pdf.getPage(n)
}

// PDF에서 모든 페이지 텍스트 추출
async function extractPdfText(pdf) {
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(" ");
    texts.push(pageText);
  }
  return texts.join("\n\n"); // 페이지 사이 빈 줄
}

// PDF의 특정 페이지를 base64 이미지로 변환 (1600px 기준)
async function pdfPageToBase64(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const MAX_DIMENSION = 1600;

  // 원본 viewport (scale 1)
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  // 1600px에 맞도록 스케일 계산
  const scale = longSide > MAX_DIMENSION ? (MAX_DIMENSION / longSide) : 1;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");

  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return dataUrl.split(",")[1]; // base64 부분만
}

// 비용 계산 (PDF 처리)
const PDF_COST = {
  visionPerPage: 0.02,  // Vision API 페이지당 $0.02
  textPerKToken: 0.003, // Claude 텍스트 input 1K token당 $0.003
  outputPerKToken: 0.015,
  usdToKrw: 1400,       // 어림 환율
};

// 텍스트 추출 비용 계산
function calcTextExtractCost(pageCount) {
  // 페이지당 약 500 토큰 가정 + 출력 500 토큰
  const inputTokens = pageCount * 500;
  const outputTokens = 500;
  const usd = (inputTokens / 1000) * PDF_COST.textPerKToken
            + (outputTokens / 1000) * PDF_COST.outputPerKToken;
  const krw = Math.round(usd * PDF_COST.usdToKrw);
  return { usd: Math.max(usd, 0.001), krw, label: `약 $${usd.toFixed(3)} (₩${krw.toLocaleString()})` };
}

// 그림 분석 비용 계산
function calcVisionCost(pageCount) {
  const usd = pageCount * PDF_COST.visionPerPage;
  const krw = Math.round(usd * PDF_COST.usdToKrw);
  return { usd, krw, label: `약 $${usd.toFixed(2)} (₩${krw.toLocaleString()})` };
}

// 처리 시간 예상
function estimateTime(pageCount, mode) {
  if (mode === "text") return Math.max(5, Math.round(pageCount * 0.3)) + "초";
  // vision: 페이지당 약 5~6초
  const seconds = pageCount * 5;
  if (seconds < 60) return `약 ${seconds}초`;
  return `약 ${Math.round(seconds / 60)}분`;
}

async function saveToSheet(role, category, content) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_knowledge", role, category, content }),
    });
    return true;
  } catch { return false; }
}

async function loadFromSheet(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_knowledge&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 대시보드 - 전체 8개 에이전트 진행률 로드
async function loadAllProgress() {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_all_progress`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 요약본 로드 (없으면 null)
async function loadSummary(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_summary&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : null;
  } catch { return null; }
}

// 요약본 저장 (기존 _요약 행 삭제 후 새로 1건 저장)
async function saveSummaryToSheet(role, summary) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_summary", role, summary }),
    });
    return true;
  } catch { return false; }
}

// 마지막 요약 이후 추가된 row 수 (요약 갱신 트리거 판단용)
async function loadSummaryCount(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=count_since_summary&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : { count: 0, hasSummary: false };
  } catch { return { count: 0, hasSummary: false }; }
}

// 특정 카테고리의 항목들만 로드 (자동 충돌 검사용)
async function loadCategoryItems(role, category) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_category_items&role=${role}&category=${encodeURIComponent(category)}`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 기존 row 교체 (신규로 교체 옵션)
async function replaceKnowledge(role, category, oldContent, newContent) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "replace_knowledge", role, category, oldContent, newContent }),
    });
    return true;
  } catch { return false; }
}

// 특정 row 삭제
async function deleteKnowledge(role, category, content) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "delete_knowledge", role, category, content }),
    });
    return true;
  } catch { return false; }
}

// 불량 사진 누적 카운트 + 패턴 존재 여부
async function loadDefectImageCount(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=count_defect_images&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : { count: 0, hasPattern: false };
  } catch { return { count: 0, hasPattern: false }; }
}

// 불량 사진 학습 데이터 모두 로드 (패턴 추출 시 사용)
async function loadDefectImageData(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_defect_image_data&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 불량 패턴 저장 (category="_불량패턴", 항상 1건만 유지)
async function saveDefectPattern(role, pattern) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_defect_pattern", role, pattern }),
    });
    return true;
  } catch { return false; }
}

// ─── 학습자료 폴더 동기화 (Step 5-C) ──────────────────────────────────────────

// 학습자료 폴더 스캔 (특정 role + _공통)
// 반환: { roleFiles: [...], commonFiles: [...] }
async function scanLearningFolder(role) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=scan_learning_folder&role=${role}`);
    const data = await res.json();
    return data.success ? data.data : { roleFiles: [], commonFiles: [] };
  } catch { return { roleFiles: [], commonFiles: [] }; }
}

// 드라이브에서 파일 내용(base64) 가져오기
// 실패 시 에러 메시지를 살려서 반환 (디버깅용)
async function fetchDriveFile(fileId) {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_drive_file&fileId=${fileId}`);
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.success) {
      return { success: true, data: data.data };
    }
    return { success: false, error: data.error || "Apps Script 응답 success=false" };
  } catch (e) {
    return { success: false, error: `네트워크 오류: ${e.message}` };
  }
}

// 파일 처리 완료로 마크
async function markFileProcessed(role, fileId, filename) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "mark_file_processed", role, fileId, filename }),
    });
    return true;
  } catch { return false; }
}

// 공통 학습 데이터 저장 (Common_Knowledge 시트)
async function saveCommonKnowledge(category, content) {
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "save_common_knowledge", category, content }),
    });
    return true;
  } catch { return false; }
}

// 공통 학습 데이터 조회
async function loadCommonKnowledge() {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_common_knowledge`);
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// 이미지를 드라이브에 업로드 (Apps Script 직접 호출)
// Content-Type: text/plain으로 CORS preflight 회피
// 응답: { success, data: { url, fileId, filename } } 또는 null
async function uploadImageToDrive(role, filename, base64, mimetype) {
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain" },  // text/plain으로 preflight 회피
      body: JSON.stringify({
        action: "upload_image",
        role,
        filename,
        base64,
        mimetype,
      }),
    });
    if (!res.ok) {
      console.error(`드라이브 업로드 HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (!data.success) {
      console.error("드라이브 업로드 실패:", data.error);
      return null;
    }
    return data.data; // { url, fileId, filename }
  } catch (e) {
    console.error("드라이브 업로드 에러:", e);
    return null;
  }
}

// 신규 항목 vs 기존 카테고리 항목들 AI 충돌 검사
// 반환: null (충돌 없음) | { conflictWith: {category, content}, type: "duplicate"|"conflict", reason: string }
async function checkConflict(role, category, newContent) {
  // 같은 카테고리 기존 데이터 로드
  const existing = await loadCategoryItems(role, category);
  if (existing.length === 0) return null; // 비교 대상 없음

  // 너무 많으면 최근 20건까지만
  const targets = existing.slice(-20);
  const targetsText = targets.map((it, i) => `${i + 1}. ${it.content}`).join("\n");

  const sys = `당신은 학습 데이터 검증자입니다. 신규 항목이 기존 데이터와 중복되거나 충돌하는지 판단하세요.

[기존 ${category} 항목들]
${targetsText}

[신규 항목]
${newContent}

[판단 기준]
- duplicate: 기존 항목 중 하나와 같은 의미 (표현만 다름)
- conflict: 기존 항목 중 하나와 같은 주제이지만 내용이 다름 (수치 다름, 절차 다름 등)
- none: 충돌 없음 (다른 주제이거나 보완 정보)

JSON으로만 답하세요. 다른 설명 없이.

응답 형식:
{"type":"duplicate"|"conflict"|"none","matchIndex":1~${targets.length}|null,"reason":"한 줄 사유"}`;

  try {
    const raw = await callClaude(sys, "판단 결과만 JSON으로 답하세요.");
    const parsed = safeJSON(raw);

    if (parsed.type === "none") return null;
    if (!parsed.matchIndex || parsed.matchIndex < 1 || parsed.matchIndex > targets.length) return null;

    return {
      type: parsed.type,
      conflictWith: targets[parsed.matchIndex - 1],
      reason: parsed.reason || "",
    };
  } catch {
    return null; // 검사 실패 시 충돌 없는 것으로 처리 (저장 막지 않음)
  }
}

// JSON 파싱
function safeJSON(raw) {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("JSON 없음");
  return JSON.parse(cleaned.slice(s, e + 1));
}

// ─── 학습 수준 계산 ───────────────────────────────────────────────────────────
function calcProgress(knowledge) {
  const categories = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];
  const result = {};
  let total = 0;
  categories.forEach(cat => {
    const items = knowledge.filter(k => k.category === cat);
    const score = cat === "교정사례"
      ? Math.min(100, items.length * 10)
      : items.length > 0 ? Math.min(100, items[0]?.content?.length / 2) : 0;
    result[cat] = Math.round(score);
    total += result[cat];
  });
  result["전체"] = Math.round(total / categories.length);
  return result;
}

// 대시보드 - 5개 지표를 0-100 점수로 정규화 (절대평가)
// 각 지표별 목표값(TARGET_VALUES) 대비 현재값의 비율, 100점 상한
function calcDashboardScore(agent) {
  const cap = (val, target) => Math.min(100, Math.round((val / target) * 100));

  const itemScore = cap(agent.itemCount || 0, TARGET_VALUES.itemCount);
  const contentScore = cap(agent.contentLength || 0, TARGET_VALUES.contentLength);
  const categoryScore = cap(agent.categoryCount || 0, TARGET_VALUES.categoryCount);
  const correctionScore = cap(agent.correctionCount || 0, TARGET_VALUES.correctionCount);
  const freshnessScore = cap(agent.recentRate || 0, TARGET_VALUES.recentRate);

  const totalScore = Math.round(
    (itemScore + contentScore + categoryScore + correctionScore + freshnessScore) / 5
  );
  return { itemScore, contentScore, categoryScore, correctionScore, freshnessScore, totalScore };
}

const SCORE_COLOR = (score) => {
  if (score >= 80) return "#34d399";
  if (score >= 60) return "#fbbf24";
  if (score >= 40) return "#f97316";
  return "#ef4444";
};

const SCORE_LABEL = (score) => {
  if (score >= 80) return "우수";
  if (score >= 60) return "양호";
  if (score >= 40) return "보통";
  return "부족";
};

// ─── 공통 컴포넌트 ────────────────────────────────────────────────────────────
function Spinner() {
  return <span style={{
    display:"inline-block", width:12, height:12,
    border:"2px solid rgba(255,255,255,0.2)",
    borderTop:"2px solid currentColor", borderRadius:"50%",
    animation:"spin 0.7s linear infinite",
  }}/>;
}

// ─── 중복/충돌 다이얼로그 (Step 3) ─────────────────────────────────────────────
// 신규 저장 시 기존 데이터와 충돌하는 경우 사용자에게 선택지 제공
function ConflictDialog({ role, category, newContent, conflict, onResolve, onCancel }) {
  const [editedContent, setEditedContent] = useState(newContent);
  const [editing, setEditing] = useState(false);
  const [processing, setProcessing] = useState(false);

  const handle = async (choice) => {
    setProcessing(true);
    try {
      if (choice === "keep_old") {
        // 기존 유지: 신규는 저장 안 함
        await onResolve("keep_old", null);
      } else if (choice === "replace") {
        // 신규로 교체: 기존 row를 신규 content로 교체
        await replaceKnowledge(role, category, conflict.conflictWith.content, newContent);
        await onResolve("replace", null);
      } else if (choice === "keep_both") {
        // 둘 다 저장: 신규를 그대로 추가
        await saveToSheet(role, category, newContent);
        await onResolve("keep_both", null);
      } else if (choice === "edit") {
        // 수정 후 저장: editedContent로 새로 저장
        if (!editedContent.trim()) {
          alert("내용을 입력해주세요");
          setProcessing(false);
          return;
        }
        await saveToSheet(role, category, editedContent);
        await onResolve("edit", editedContent);
      } else if (choice === "skip") {
        // 건너뛰기: 아무것도 저장 안 함
        await onResolve("skip", null);
      }
    } catch (e) {
      alert("처리 실패: " + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const typeLabel = conflict.type === "duplicate" ? "중복" : "충돌";
  const typeColor = conflict.type === "duplicate" ? "#a78bfa" : "#f59e0b";

  return (
    <div style={{
      position:"fixed", top:0, left:0, right:0, bottom:0,
      background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:1000, padding:"16px", animation:"fadeUp 0.2s ease both",
    }}>
      <div style={{
        background:"#0f172a", border:`1.5px solid ${typeColor}40`,
        borderRadius:14, padding:"20px", maxWidth:540, width:"100%",
        maxHeight:"90vh", overflowY:"auto",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
          <span style={{
            background:`${typeColor}20`, color:typeColor,
            padding:"3px 10px", borderRadius:5, fontSize:11, fontWeight:800,
          }}>⚠️ {typeLabel} 감지</span>
          <span style={{ fontSize:11, color:"#64748b" }}>{category}</span>
        </div>

        <div style={{ fontSize:12, color:"#94a3b8", marginBottom:14, lineHeight:1.6 }}>
          {conflict.reason || "기존 학습 내용과 중복되거나 충돌됩니다"}
        </div>

        {/* 기존 내용 */}
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:"#64748b", fontWeight:700, marginBottom:5 }}>📂 기존 내용</div>
          <div style={{
            background:"rgba(15,23,42,0.6)", border:"1px solid rgba(51,65,85,0.4)",
            borderRadius:7, padding:"10px 12px", fontSize:12, color:"#cbd5e1",
            lineHeight:1.6, whiteSpace:"pre-wrap",
          }}>{conflict.conflictWith.content}</div>
        </div>

        {/* 신규 내용 (수정 모드면 textarea, 아니면 표시) */}
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:10, color:"#64748b", fontWeight:700, marginBottom:5 }}>✨ 신규 내용</div>
          {editing ? (
            <textarea value={editedContent} onChange={e => setEditedContent(e.target.value)}
              rows={4} style={{
                width:"100%", background:"rgba(15,23,42,0.8)",
                border:`1.5px solid ${typeColor}50`, borderRadius:7,
                color:"#dde4f0", padding:"10px 12px", fontSize:12,
                outline:"none", resize:"vertical", lineHeight:1.6,
                boxSizing:"border-box", fontFamily:"inherit",
              }}/>
          ) : (
            <div style={{
              background:`${typeColor}08`, border:`1px solid ${typeColor}30`,
              borderRadius:7, padding:"10px 12px", fontSize:12, color:"#dde4f0",
              lineHeight:1.6, whiteSpace:"pre-wrap",
            }}>{editedContent}</div>
          )}
        </div>

        {/* 처리 버튼 5개 */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:6, marginBottom:6 }}>
          <button onClick={() => handle("keep_old")} disabled={processing} style={btnStyle("#94a3b8")}>
            📂 기존 유지
          </button>
          <button onClick={() => handle("replace")} disabled={processing} style={btnStyle("#34d399")}>
            ✨ 신규로 교체
          </button>
          <button onClick={() => handle("keep_both")} disabled={processing} style={btnStyle("#a78bfa")}>
            ➕ 둘 다 저장
          </button>
          {!editing ? (
            <button onClick={() => setEditing(true)} disabled={processing} style={btnStyle("#fbbf24")}>
              ✏️ 수정하기
            </button>
          ) : (
            <button onClick={() => handle("edit")} disabled={processing} style={btnStyle("#fbbf24")}>
              💾 수정 저장
            </button>
          )}
        </div>
        <button onClick={() => handle("skip")} disabled={processing} style={{
          ...btnStyle("#64748b"), width:"100%",
        }}>
          ⏭ 건너뛰기 (저장 안 함)
        </button>

        {processing && (
          <div style={{ marginTop:10, textAlign:"center", color:"#94a3b8", fontSize:11 }}>
            <Spinner/> 처리 중...
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(color) {
  return {
    padding:"9px 12px",
    background:`${color}15`,
    border:`1px solid ${color}40`,
    borderRadius:7, color: color,
    fontSize:12, fontWeight:700, cursor:"pointer",
  };
}

function smallBtnStyle(color) {
  return {
    padding:"6px 8px",
    background:`${color}15`,
    border:`1px solid ${color}40`,
    borderRadius:5, color: color,
    fontSize:11, fontWeight:700, cursor:"pointer",
  };
}

function ProgressBar({ label, value, color }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <span style={{ fontSize:11, color:"#94a3b8" }}>{label}</span>
        <span style={{ fontSize:11, color, fontWeight:800 }}>{value}%</span>
      </div>
      <div style={{ height:6, background:"rgba(51,65,85,0.5)", borderRadius:3 }}>
        <div style={{
          height:"100%", borderRadius:3,
          width:`${value}%`,
          background:`linear-gradient(90deg, ${color}, ${color}99)`,
          transition:"width 0.5s ease",
        }}/>
      </div>
    </div>
  );
}

function SaveBtn({ onClick, saving, saved }) {
  return (
    <button onClick={onClick} disabled={saving} style={{
      padding:"8px 16px",
      background: saved ? "rgba(52,211,153,0.2)" : "rgba(59,130,246,0.15)",
      border: `1px solid ${saved ? "rgba(52,211,153,0.4)" : "rgba(59,130,246,0.3)"}`,
      borderRadius:7, color: saved ? "#34d399" : "#93c5fd",
      fontSize:12, fontWeight:700, cursor:"pointer",
      display:"inline-flex", alignItems:"center", gap:6,
    }}>
      {saving ? <><Spinner/>저장 중...</> : saved ? "✅ 저장됨" : "💾 저장"}
    </button>
  );
}

// ─── STEP 1: 채팅 학습 ────────────────────────────────────────────────────────
function TabChat({ role, roleInfo }) {
  const [msgs, setMsgs] = useState([{
    role:"assistant",
    content:`안녕하세요! 저는 ${roleInfo.label}(${role}) AI입니다.\n\n학습 데이터를 불러오는 중...`,
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [summary, setSummary] = useState(null);  // 시트에서 로드한 요약본
  const [commonKnowledge, setCommonKnowledge] = useState([]);  // Common_Knowledge 시트 (모든 에이전트 공유)
  const [initialized, setInitialized] = useState(false);
  const [conflictQueue, setConflictQueue] = useState([]);
  const [currentConflict, setCurrentConflict] = useState(null);
  const bottomRef = useRef();
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      setCurrentConflict(conflictQueue[0]);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
  };

  // 시작 시 요약본 + 공통 학습 데이터 로드 + 첫 메시지 동적 생성
  useEffect(() => {
    if (initialized) return;
    (async () => {
      try {
        // 본인 요약과 공통 학습 데이터를 병렬 로드 (속도 최적화)
        const [summaryData, commonData] = await Promise.all([
          loadSummary(role),
          loadCommonKnowledge(),
        ]);
        setCommonKnowledge(commonData || []);

        if (summaryData && summaryData.content) {
          // 요약본 있음 → AI에게 부족 부분 질문 동적 생성 요청
          setSummary(summaryData.content);

          const sys = `당신은 ${roleInfo.label}(${role}) AI입니다. 아래는 지금까지 학습된 요약본입니다.

[학습 요약]
${summaryData.content}

이 학습 내용을 보고, 아직 부족하거나 추가 학습이 필요한 영역 1~2가지를 골라서
사용자에게 자연스럽게 질문하는 첫 인사말을 작성하세요.

규칙:
- "안녕하세요"로 시작
- "지난 학습을 이어가겠습니다" 같은 표현으로 친근감 표시
- 부족한 영역을 구체적으로 언급 (예: "아직 교정사례 학습이 적은데, 최근 사례가 있으면 알려주세요")
- 마지막에 안내문 추가: "(전체 학습 내용을 보고 싶으면 '요약'이라고 입력해 주세요)"
- 200자 이내, 한국어`;

          try {
            const reply = await callClaude(sys, "첫 인사말을 만들어주세요.");
            setMsgs([{ role:"assistant", content: reply }]);
          } catch {
            // AI 호출 실패 시 기본 메시지
            setMsgs([{
              role:"assistant",
              content:`안녕하세요! ${roleInfo.label}(${role}) AI입니다. 지난 학습을 이어가겠습니다.\n\n오늘은 어떤 부분을 더 알려주시겠어요?\n\n(전체 학습 내용을 보고 싶으면 '요약'이라고 입력해 주세요)`
            }]);
          }
        } else {
          // 요약본 없음 → 첫 학습 인사
          setMsgs([{
            role:"assistant",
            content:`안녕하세요! 저는 ${roleInfo.label}(${role}) AI입니다.\n\n지금부터 공장 상황과 업무 방식을 배워갈게요. 편하게 알려주세요.\n\n예를 들어:\n• 어떤 공장인지, 어떤 제품을 만드는지\n• 주요 공정 흐름\n• 평소 신경 쓰는 부분`
          }]);
        }
      } catch (e) {
        // 로드 실패 시 기본 메시지
        setMsgs([{
          role:"assistant",
          content:`안녕하세요! 저는 ${roleInfo.label}(${role}) AI입니다.\n\n지금부터 공장 상황과 업무 방식을 배워갈게요.`
        }]);
      } finally {
        setInitialized(true);
      }
    })();
  }, [role, roleInfo, initialized]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");

    // "요약" 입력 시 요약본 표시 (AI 호출 없음)
    if (msg === "요약" || msg === "요약보여줘" || msg === "요약 보여줘") {
      const newMsgs = [...msgs, { role:"user", content:msg }];
      if (summary) {
        setMsgs([...newMsgs, {
          role:"assistant",
          content:`📋 지금까지 학습된 내용입니다:\n\n${summary}\n\n추가로 알려주실 내용이 있으면 말씀해 주세요.`
        }]);
      } else {
        setMsgs([...newMsgs, {
          role:"assistant",
          content:"아직 저장된 요약이 없습니다. 학습 데이터가 5건 이상 누적되면 자동으로 요약이 생성됩니다."
        }]);
      }
      return;
    }

    const newMsgs = [...msgs, { role:"user", content:msg }];
    setMsgs(newMsgs);
    setLoading(true);
    try {
      // ─── 디테일 모드 감지 ───
      // 사용자가 구체적/디테일한 정보를 원하는지 키워드로 판단
      const detailKeywords = ["상세", "자세히", "정확", "구체적", "수치", "값", "기준", "정확한", "어떤", "뭐였", "무엇", "얼마"];
      const categoryKeywords = {
        "공장정보": ["공장", "제품", "공정", "라인"],
        "업무역할": ["역할", "업무", "담당", "책임"],
        "판단기준": ["판단", "기준", "결정", "우선순위", "보고", "에스컬레이션"],
        "협업방식": ["협업", "협조", "소통", "보고", "회의"],
        "교정사례": ["사례", "케이스", "예시", "이전", "지난번"],
      };

      const isDetailMode = detailKeywords.some(kw => msg.includes(kw));
      const matchedCategories = Object.entries(categoryKeywords)
        .filter(([_, kws]) => kws.some(kw => msg.includes(kw)))
        .map(([cat]) => cat);

      // 디테일 모드면 원본 데이터 로드
      let detailContext = "";
      if (isDetailMode || matchedCategories.length > 0) {
        const allKnowledge = await loadFromSheet(role);
        // _요약은 제외
        const filtered = allKnowledge.filter(k => k.category !== "_요약");

        // 매칭 카테고리가 있으면 해당 카테고리만, 없으면 모든 원본
        let targetData = filtered;
        if (matchedCategories.length > 0) {
          targetData = filtered.filter(k => matchedCategories.includes(k.category));
        }

        if (targetData.length > 0) {
          // 너무 많으면 최신 30건까지만
          const limited = targetData.slice(-30);
          const dataText = limited.map(k => `[${k.category}] ${k.content}`).join("\n");
          detailContext = `\n\n[참고 - 원본 학습 데이터 ${matchedCategories.length > 0 ? `(${matchedCategories.join(", ")} 카테고리)` : "(전체)"}]\n${dataText.slice(0, 6000)}\n\n위 원본 데이터에서 정확한 정보를 찾아 답변하세요.`;
        }
      }

      const summaryContext = summary
        ? `\n\n[기존 학습 요약]\n${summary}\n\n위 내용을 이미 알고 있다는 전제로 답변하세요. 같은 질문을 반복하지 마세요.`
        : "";

      // 공통 학습 데이터 컨텍스트 (모든 에이전트 공유 - 회사 규정/공통 지침)
      // 디테일 모드일 때는 detailContext가 크므로 commonContext는 줄여서 토큰 절약
      const commonLimit = isDetailMode || matchedCategories.length > 0 ? 2000 : 4000;
      const commonContext = (commonKnowledge && commonKnowledge.length > 0)
        ? `\n\n[공통 회사 규정/지침 - 모든 에이전트 공유]\n${
            commonKnowledge
              .map(c => `[${c.category}] ${c.content}`)
              .join("\n")
              .slice(0, commonLimit)
          }\n\n위 공통 규정/지침은 ${roleInfo.label} 업무 답변의 기본 전제입니다. 본인 업무 답변이 위 규정과 충돌하지 않도록 답변하세요.`
        : "";

      const system = `당신은 ${roleInfo.label} AI로 훈련 중입니다.
사용자가 공장 상황과 ${role} 업무를 알려주면 자연스럽게 대화하며 더 깊이 파악하세요.
모르는 부분은 추가 질문하고, 중요한 내용은 확인하세요.
수율/KPI 수치보다 실제 업무 흐름, 협업 방식, 현장 문제에 집중하세요.
150자 이내로 간결하게 한국어로 답하세요.${summaryContext}${commonContext}${detailContext}`;
      const reply = await callClaude(system, msg);
      setMsgs(m => [...m, { role:"assistant", content:reply }]);
    } catch {
      setMsgs(m => [...m, { role:"assistant", content:"⚠️ 오류 발생. 다시 시도해주세요." }]);
    } finally { setLoading(false); }
  };

  // 요약본 재생성 (백그라운드)
  const regenerateSummary = async () => {
    try {
      const knowledge = await loadFromSheet(role);
      // _요약은 제외하고 일반 학습 데이터만
      const filtered = knowledge.filter(k => k.category !== "_요약");
      if (filtered.length === 0) return;

      const dataText = filtered.map(k => `[${k.category}] ${k.content}`).join("\n");

      const sys = `당신은 학습 데이터 정리자입니다. ${roleInfo.label}(${role})의 학습 내용을 카테고리별로 구조화해 요약하세요.

[학습 데이터]
${dataText.slice(0, 8000)}

다음 형식으로 한국어 요약 작성:
[공장정보] (한 줄 요약)
[업무역할] (한 줄 요약)
[판단기준] (한 줄 요약, 핵심 기준 1~3가지)
[협업방식] (한 줄 요약)
[교정사례] (한 줄 요약, 없으면 "없음")
[미흡 영역] (학습이 부족해 보이는 영역 1~2가지)

각 항목 한 줄씩, 전체 500자 이내.`;

      const summaryText = await callClaude(sys, "요약을 작성하세요.");
      await saveSummaryToSheet(role, summaryText);
      setSummary(summaryText); // 로컬 state도 갱신
    } catch (e) {
      console.error("요약 재생성 실패:", e);
    }
  };

  const saveChat = async () => {
    setSaving(true);
    try {
      const conv = msgs.map(m => `${m.role==="user"?"사용자":"AI"}: ${m.content}`).join("\n");
      const system = `대화에서 ${roleInfo.label} 업무 정보를 추출해 JSON만 출력:
{"공장정보":"공장/제품/공정 요약","업무역할":"${role} 담당 업무","협업방식":"타 엔지니어 소통 방식"}`;
      const raw = await callClaude(system, conv);
      const parsed = safeJSON(raw);

      // 각 카테고리별로 충돌 검사 후 처리
      const conflicts = [];
      for (const [cat, content] of Object.entries(parsed)) {
        if (!content) continue;
        const conflict = await checkConflict(role, cat, content);
        if (conflict) {
          conflicts.push({ category: cat, content, conflict });
        } else {
          await saveToSheet(role, cat, content);
        }
      }

      // 충돌 항목들을 큐에 쌓아 사용자가 차례로 처리
      if (conflicts.length > 0) {
        setConflictQueue(conflicts);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      // 5건 누적 시 백그라운드에서 요약 재생성
      const countData = await loadSummaryCount(role);
      if (countData && countData.count >= 5) {
        regenerateSummary(); // await 안 함 (백그라운드 실행)
      }
    } catch { alert("저장 실패. 다시 시도해주세요."); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:14 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>💬 공장 & 업무 대화로 학습</div>
          {commonKnowledge.length > 0 && (
            <span title="모든 에이전트가 공유하는 회사 규정/지침이 채팅 컨텍스트에 자동 주입됩니다" style={{
              background:"rgba(212,175,55,0.12)",
              border:"1px solid rgba(212,175,55,0.35)",
              borderRadius:10,
              padding:"2px 8px",
              fontSize:10.5,
              fontWeight:700,
              color:"#d4af37",
              cursor:"help",
            }}>📚 공통 {commonKnowledge.length}건 적용 중</span>
          )}
        </div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          공장/제품/공정/업무 방식을 자유롭게 알려주세요
        </div>
      </div>

      {/* 가이드 버튼 */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
        {summary && (
          <button onClick={() => setInput("요약")} style={{
            background:"rgba(167,139,250,0.1)", border:"1px solid rgba(167,139,250,0.3)",
            borderRadius:14, padding:"4px 11px", color:"#a78bfa", fontSize:11, cursor:"pointer", fontWeight:700,
          }}>📋 요약 보기</button>
        )}
        {["어떤 공장인지 알려줄게요", "주요 공정 흐름은요", "하루 일과가 어때요", "자주 생기는 문제는"].map((q,i) => (
          <button key={i} onClick={() => setInput(q)} style={{
            background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.2)",
            borderRadius:14, padding:"4px 11px", color:"#93c5fd", fontSize:11, cursor:"pointer",
          }}>{q}</button>
        ))}
      </div>

      {/* 채팅창 */}
      <div style={{
        background:"rgba(4,8,15,0.7)", border:"1px solid rgba(59,130,246,0.15)",
        borderRadius:12, padding:14, height:320, overflowY:"auto", marginBottom:10,
      }}>
        {msgs.map((m,i) => (
          <div key={i} style={{
            display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start",
            marginBottom:10, animation:"fadeUp 0.2s ease both",
          }}>
            {m.role==="assistant" && (
              <div style={{
                width:26, height:26, borderRadius:"50%",
                background:roleInfo.bg, border:`1.5px solid ${roleInfo.color}44`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:12, marginRight:7, flexShrink:0, marginTop:2,
              }}>{roleInfo.icon}</div>
            )}
            <div style={{
              maxWidth:"80%",
              background:m.role==="user"?"rgba(59,130,246,0.12)":"rgba(20,30,50,0.9)",
              border:`1px solid ${m.role==="user"?"rgba(59,130,246,0.25)":"rgba(51,65,85,0.35)"}`,
              borderRadius:m.role==="user"?"12px 3px 12px 12px":"3px 12px 12px 12px",
              padding:"8px 12px", fontSize:12.5, color:"#dde4f0",
              lineHeight:1.7, whiteSpace:"pre-wrap",
            }}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <div style={{ width:26, height:26, borderRadius:"50%", background:roleInfo.bg,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:12 }}>
              {roleInfo.icon}
            </div>
            <span style={{ fontSize:12, color:"#475569", animation:"pulse 1s infinite" }}>생각 중...</span>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      <div style={{ display:"flex", gap:8, marginBottom:10 }}>
        <input value={input} onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&send()}
          placeholder="자유롭게 입력하세요 (Enter 전송)"
          style={{
            flex:1, background:"rgba(8,14,26,0.9)",
            border:"1.5px solid rgba(59,130,246,0.25)", borderRadius:8,
            color:"#e2e8f0", padding:"9px 13px", fontSize:13, outline:"none",
          }}
        />
        <button onClick={send} disabled={!input.trim()||loading} style={{
          padding:"9px 16px",
          background:input.trim()&&!loading?"linear-gradient(135deg,#3b82f6,#22d3ee)":"rgba(51,65,85,0.3)",
          border:"none", borderRadius:8, color:"#fff", fontSize:13, fontWeight:700,
          cursor:input.trim()&&!loading?"pointer":"not-allowed",
        }}>전송</button>
      </div>

      <SaveBtn onClick={saveChat} saving={saving} saved={saved}/>

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 2: 업무 규칙 ────────────────────────────────────────────────────────
const RULE_FIELDS = {
  Cell_PE: [
    { key:"판단기준", label:"Cell 공정 이상 발생 시 대응 순서", placeholder:"예: 이상 감지 → 현장 확인 → 조장 보고 → 원인 파악 → ME/TE 협의" },
    { key:"협업방식", label:"Cell ME·TE팀과 협업 방식", placeholder:"예: 설비 고장은 ME에게 즉시 연락, 공정 개선은 TE와 주 1회 협의" },
    { key:"판단기준", label:"생산 vs 품질 vs 안전 우선순위", placeholder:"예: 안전 최우선, 불량 발생 시 라인 정지 가능, 불량 출하 금지" },
    { key:"판단기준", label:"보고 & 에스컬레이션 기준", placeholder:"예: 다운타임 30분 초과 시 팀장 보고, 불량 배치 시 품질팀 즉시 통보" },
  ],
  Cell_ME: [
    { key:"판단기준", label:"Cell 설비 고장 시 대응 순서", placeholder:"예: 알람 확인 → 현장 점검 → 원인 파악 → 부품 교체 → 테스트 런" },
    { key:"협업방식", label:"Cell PE·TE팀과 협업 방식", placeholder:"예: 생산 영향 큰 고장은 PE에게 즉시 보고, 공정 조건 변경은 TE와 협의" },
    { key:"판단기준", label:"PM(예방보전) 기준", placeholder:"예: MTBF 기반 PM 주기, 소모품 교체 기준, 예방보전 우선순위" },
    { key:"판단기준", label:"라인 정지 vs 임시 조치 판단 기준", placeholder:"예: 즉시 정지 조건, 임시 조치 후 운영 가능 조건" },
  ],
  Cell_TE: [
    { key:"판단기준", label:"Cell 공정 조건 변경 기준", placeholder:"예: 불량률 기준 초과 시 조건 검토, 변경 전 ME/PE 협의 필수" },
    { key:"협업방식", label:"Cell PE·ME팀과 협업 방식", placeholder:"예: 품질 이슈는 PE와 즉시 공유, 설비 조건은 ME와 협의 후 변경" },
    { key:"판단기준", label:"불량 원인 분석 방법", placeholder:"예: 4M 분석(Man/Machine/Material/Method), 재현 테스트, 데이터 분석" },
    { key:"판단기준", label:"재발 방지 기준", placeholder:"예: 동일 불량 2회 이상 시 근본 원인 분석서 작성, 개선 검증 기간 설정" },
  ],
  Elec_PE: [
    { key:"판단기준", label:"Elec 공정 이상 발생 시 대응 순서", placeholder:"예: 이상 감지 → 현장 확인 → 조장 보고 → 원인 파악 → ME/TE 협의" },
    { key:"협업방식", label:"Elec ME·TE팀과 협업 방식", placeholder:"예: 설비 고장은 ME에게 즉시 연락, 공정 개선은 TE와 주 1회 협의" },
    { key:"판단기준", label:"생산 vs 품질 vs 안전 우선순위", placeholder:"예: 안전 최우선, 불량 발생 시 라인 정지 가능, 불량 출하 금지" },
    { key:"판단기준", label:"보고 & 에스컬레이션 기준", placeholder:"예: 다운타임 30분 초과 시 팀장 보고, 불량 배치 시 품질팀 즉시 통보" },
  ],
  Elec_ME: [
    { key:"판단기준", label:"Elec 설비 고장 시 대응 순서", placeholder:"예: 알람 확인 → 현장 점검 → 원인 파악 → 부품 교체 → 테스트 런" },
    { key:"협업방식", label:"Elec PE·TE팀과 협업 방식", placeholder:"예: 생산 영향 큰 고장은 PE에게 즉시 보고, 공정 조건 변경은 TE와 협의" },
    { key:"판단기준", label:"PM(예방보전) 기준", placeholder:"예: MTBF 기반 PM 주기, 소모품 교체 기준, 예방보전 우선순위" },
    { key:"판단기준", label:"라인 정지 vs 임시 조치 판단 기준", placeholder:"예: 즉시 정지 조건, 임시 조치 후 운영 가능 조건" },
  ],
  Elec_TE: [
    { key:"판단기준", label:"Elec 공정 조건 변경 기준", placeholder:"예: 불량률 기준 초과 시 조건 검토, 변경 전 ME/PE 협의 필수" },
    { key:"협업방식", label:"Elec PE·ME팀과 협업 방식", placeholder:"예: 품질 이슈는 PE와 즉시 공유, 설비 조건은 ME와 협의 후 변경" },
    { key:"판단기준", label:"불량 원인 분석 방법", placeholder:"예: 4M 분석(Man/Machine/Material/Method), 재현 테스트, 데이터 분석" },
    { key:"판단기준", label:"재발 방지 기준", placeholder:"예: 동일 불량 2회 이상 시 근본 원인 분석서 작성, 개선 검증 기간 설정" },
  ],
  FA: [
    { key:"판단기준", label:"반송 설비(C/V·Stocker·OHT·AGV) 이상 시 대응 순서", placeholder:"예: 알람 확인 → 영향 라인 파악 → 우회 경로 확보 → 정비 → 재가동" },
    { key:"협업방식", label:"PE·ME·TE팀과 협업 방식", placeholder:"예: 라인 정지 영향 시 PE 즉시 공유, 본 라인 설비와 정비 일정은 ME와 협의, 반송 중 품질 영향 시 TE와 협업" },
    { key:"판단기준", label:"WIP(공정 중 재공) 관리 기준", placeholder:"예: Stocker 처리 한계, 공정별 WIP 적정 수준, 누적 시 라인 속도 조정 기준" },
    { key:"판단기준", label:"반송 이슈 vs 공정 이슈 구분 기준", placeholder:"예: 잼/충돌/통신두절은 반송 측, 대기시간 영향은 공정 변수 함께 검토" },
  ],
  Vision: [
    { key:"판단기준", label:"외관 검사 기준 및 불량 분류", placeholder:"예: 불량 등급 기준(Critical/Major/Minor), 자동 검출 기준, 수동 검사 트리거" },
    { key:"협업방식", label:"PE·TE팀과 협업 방식", placeholder:"예: 새 불량 유형 발생 시 TE와 즉시 협의, 알고리즘 변경 시 PE 승인" },
    { key:"판단기준", label:"비전 시스템 이상 대응", placeholder:"예: 검출율 급감 시 조치 기준, 카메라·조명 점검 주기, 재교정 기준" },
    { key:"판단기준", label:"불량 이미지 분석 방법", placeholder:"예: 이미지 패턴 분류 기준, 오검출·미검출 구분, 데이터 축적 및 개선 방법" },
  ],
};

function TabRules({ role, roleInfo }) {
  const fields = RULE_FIELDS[role] || RULE_FIELDS[Object.keys(RULE_FIELDS)[0]];
  const [values, setValues] = useState(Object.fromEntries(fields.map((_,i) => [i, ""])));
  const [loadingExisting, setLoadingExisting] = useState(true);  // 기존 입력 로드 중
  const [hasExisting, setHasExisting] = useState(false);  // 기존 입력 있었는지 (배지 표시용)
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [conflictQueue, setConflictQueue] = useState([]); // 충돌 대기 큐
  const [currentConflict, setCurrentConflict] = useState(null); // 현재 처리 중인 충돌

  // 시트에서 기존 입력 내용 로드 (영속성)
  // - 같은 필드 라벨로 저장된 항목 중 가장 최근(updated_at) 것을 textarea에 복원
  // - role이 바뀌면 다시 로드 (race condition 방지: cancelled 플래그)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingExisting(true);
      setHasExisting(false);
      // 역할 바뀐 직후 잔상 방지 — 일단 빈 칸으로 리셋
      setValues(Object.fromEntries(fields.map((_,i) => [i, ""])));
      try {
        const items = await loadFromSheet(role);
        if (cancelled) return;
        const restored = {};
        let foundAny = false;
        fields.forEach((field, i) => {
          const labelPrefix = `[${field.label}]`;
          const matched = (items || [])
            .filter(it => it.content && it.content.startsWith(labelPrefix))
            .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))[0];
          if (matched) {
            restored[i] = matched.content.slice(labelPrefix.length).trim();
            foundAny = true;
          }
        });
        if (foundAny) {
          setValues(v => ({ ...v, ...restored }));
          setHasExisting(true);
        }
      } catch (e) {
        console.error("[TabRules] 기존 입력 로드 실패:", e);
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [role]);

  // 큐에서 다음 충돌 꺼내기
  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      const next = conflictQueue[0];
      setCurrentConflict(next);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const save = async () => {
    setSaving(true);
    try {
      const conflicts = [];
      const safeItems = []; // 충돌 없는 항목

      // 1단계: 각 입력 항목별로 충돌 검사
      for (const [idx, content] of Object.entries(values)) {
        if (!content.trim()) continue;
        const field = fields[parseInt(idx)];
        const fullContent = `[${field.label}] ${content}`;
        const conflict = await checkConflict(role, field.key, fullContent);
        if (conflict) {
          conflicts.push({ category: field.key, content: fullContent, conflict });
        } else {
          safeItems.push({ category: field.key, content: fullContent });
        }
      }

      // 2단계: 충돌 없는 항목은 즉시 저장
      for (const item of safeItems) {
        await saveToSheet(role, item.category, item.content);
      }

      // 3단계: 충돌 항목들을 큐에 쌓아서 사용자에게 차례로 표시
      if (conflicts.length > 0) {
        setConflictQueue(conflicts);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("저장 실패"); }
    finally { setSaving(false); }
  };

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
    // useEffect가 다음 큐 항목을 자동으로 처리
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>📋 업무 규칙 & 판단 기준</div>
          {loadingExisting && (
            <span style={{
              background:"rgba(100,116,139,0.15)",
              border:"1px solid rgba(100,116,139,0.3)",
              borderRadius:10, padding:"2px 8px",
              fontSize:10.5, fontWeight:700, color:"#94a3b8",
            }}>기존 입력 불러오는 중…</span>
          )}
          {!loadingExisting && hasExisting && (
            <span title="시트에 저장된 기존 입력 내용을 자동 복원했습니다" style={{
              background:"rgba(34,197,94,0.12)",
              border:"1px solid rgba(34,197,94,0.35)",
              borderRadius:10, padding:"2px 8px",
              fontSize:10.5, fontWeight:700, color:"#4ade80",
              cursor:"help",
            }}>✅ 기존 입력 복원됨</span>
          )}
        </div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          {roleInfo.label}로서 실제로 따르는 행동 원칙을 입력하세요
        </div>
      </div>

      {fields.map((f, i) => (
        <div key={i} style={{
          background:"rgba(15,23,42,0.6)", border:`1px solid ${roleInfo.color}20`,
          borderRadius:10, padding:"14px 16px", marginBottom:12,
        }}>
          <div style={{ fontSize:11, color:roleInfo.color, fontWeight:800, marginBottom:8 }}>
            {f.label}
          </div>
          <textarea
            value={values[i] || ""}
            onChange={e => setValues(v => ({ ...v, [i]: e.target.value }))}
            placeholder={f.placeholder}
            rows={2}
            style={{
              width:"100%", background:"rgba(4,8,15,0.8)",
              border:"1.5px solid rgba(51,65,85,0.6)",
              borderRadius:7, color:"#dde4f0",
              padding:"9px 12px", fontSize:12.5, outline:"none",
              resize:"vertical", lineHeight:1.7,
              boxSizing:"border-box", fontFamily:"inherit",
            }}
          />
        </div>
      ))}

      <SaveBtn onClick={save} saving={saving} saved={saved}/>

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 3: 상황 교정 ────────────────────────────────────────────────────────
function TabCorrection({ role, roleInfo, knowledge }) {
  const [situation, setSituation] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [correction, setCorrection] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cases, setCases] = useState([]);
  const [conflictQueue, setConflictQueue] = useState([]);
  const [currentConflict, setCurrentConflict] = useState(null);

  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      setCurrentConflict(conflictQueue[0]);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
  };

  const SAMPLES = {
    Cell_PE: [
      "오전 10시, STK 라인 불량률이 갑자기 1.8%로 올랐다. 원인 불명. 라인은 현재 가동 중.",
      "야간 교대 중 CUT 설비가 멈췄고 ME는 부품 교체에 2시간 필요.",
      "기술팀에서 Cell 공정 조건 변경 요청. 변경 시 생산 속도 15% 감소 예상.",
    ],
    Cell_ME: [
      "STK-1-B3 설비에서 진공 오류 알람 발생. 생산은 계속 진행 중.",
      "동일 부품이 이번 주 3번째 교체됨. 근본 원인 파악이 필요한 상황.",
      "PM 일정이 생산 피크 기간과 겹침. PE에서 PM 연기 요청이 왔다.",
    ],
    Cell_TE: [
      "Cell 불량률이 0.3%에서 1.5%로 갑자기 상승. 공정 조건은 변경 없음.",
      "신규 원자재 로트 투입 후 불량 발생. 기존 로트와 혼용 중.",
      "PE에서 생산 속도 증가 요청. 현재 공정 조건에서 품질 리스크가 있음.",
    ],
    Elec_PE: [
      "오전 10시, Elec 라인 불량률이 갑자기 상승. 원인 불명. 라인은 현재 가동 중.",
      "야간 교대 중 전극 설비가 멈췄고 ME는 부품 교체에 2시간 필요.",
      "기술팀에서 Elec 공정 조건 변경 요청. 변경 시 생산 속도 감소 예상.",
    ],
    Elec_ME: [
      "Elec 설비에서 오류 알람 발생. 생산은 계속 진행 중.",
      "동일 부품이 이번 주 3번째 교체됨. Elec 라인 근본 원인 파악 필요.",
      "Elec PM 일정이 생산 피크 기간과 겹침. PE에서 PM 연기 요청.",
    ],
    Elec_TE: [
      "Elec 불량률이 갑자기 상승. 공정 조건은 변경 없음.",
      "신규 전극 원자재 로트 투입 후 불량 발생. 기존 로트와 혼용 중.",
      "PE에서 Elec 생산 속도 증가 요청. 현재 공정 조건에서 품질 리스크 있음.",
    ],
    FA: [
      "OHT 호기 충돌로 Cell 라인 반송 지연 발생. 라인 대기 시간 30분 누적 중.",
      "Stocker 처리 한계 도달로 공정 앞단 WIP 급증. 라인 속도 조정 검토 필요.",
      "AGV 통신 두절 빈발. MES 연동 문제인지 통신망 문제인지 구분 필요.",
    ],
    Vision: [
      "비전 검사기에서 불량 검출율이 갑자기 50% 이하로 떨어졌다.",
      "새로운 불량 유형이 발생했는데 현재 알고리즘이 검출하지 못하고 있다.",
      "조명 노후화로 의심되는 오검출이 증가하고 있다. 생산에 영향을 주고 있음.",
    ],
  };

  const askAI = async () => {
    if (!situation.trim()) return;
    setLoading(true);
    setAiAnswer("");
    try {
      const knowledgeText = knowledge.map(k => `${k.category}: ${k.content}`).join("\n");
      const system = `당신은 아래 지식을 보유한 ${roleInfo.label}(${role}) AI입니다.
${knowledgeText || "기본 역할 정의만 있음"}
주어진 현장 상황에 대해 ${roleInfo.label}로서 즉각적인 판단과 행동 방침을 150자 이내로 답하세요.`;
      const reply = await callClaude(system, situation);
      setAiAnswer(reply);
    } catch { setAiAnswer("⚠️ 오류 발생"); }
    finally { setLoading(false); }
  };

  const saveCase = async () => {
    setSaving(true);
    try {
      const content = `상황: ${situation} | AI판단: ${aiAnswer} | 교정: ${correction || "정확함"}`;

      // 충돌 검사
      const conflict = await checkConflict(role, "교정사례", content);
      if (conflict) {
        setConflictQueue([{ category: "교정사례", content, conflict }]);
      } else {
        await saveToSheet(role, "교정사례", content);
      }

      setCases(c => [...c, { situation, aiAnswer, correction, date: new Date().toLocaleDateString("ko-KR") }]);
      setSituation(""); setAiAnswer(""); setCorrection("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { alert("저장 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>🎯 상황 던지기 & 판단 교정</div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          실제 상황 입력 → AI 판단 확인 → 틀리면 교정 → 저장
        </div>
      </div>

      {/* 샘플 */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:10, color:"#374151", fontWeight:700, marginBottom:6, letterSpacing:1 }}>샘플 상황</div>
        {(SAMPLES[role]||SAMPLES.PE).map((s,i) => (
          <button key={i} onClick={() => setSituation(s)} style={{
            display:"block", width:"100%", textAlign:"left",
            background:"rgba(167,139,250,0.06)", border:"1px solid rgba(167,139,250,0.18)",
            borderRadius:7, padding:"7px 12px", color:"#a78bfa",
            fontSize:11.5, cursor:"pointer", lineHeight:1.5, marginBottom:5,
          }}>{s}</button>
        ))}
      </div>

      <textarea value={situation} onChange={e=>setSituation(e.target.value)}
        placeholder="현장 상황을 직접 입력하세요..."
        rows={3} style={{
          width:"100%", background:"rgba(4,8,15,0.8)",
          border:"1.5px solid rgba(167,139,250,0.3)", borderRadius:8,
          color:"#e2e8f0", padding:"10px 13px", fontSize:13, outline:"none",
          resize:"vertical", lineHeight:1.7, boxSizing:"border-box",
          fontFamily:"inherit", marginBottom:10,
        }}
      />

      <button onClick={askAI} disabled={!situation.trim()||loading} style={{
        padding:"10px 18px", marginBottom:14,
        background:situation&&!loading?"linear-gradient(135deg,#a78bfa,#7c3aed)":"rgba(51,65,85,0.3)",
        border:"none", borderRadius:8,
        color:situation&&!loading?"#fff":"#374151",
        fontSize:13, fontWeight:700,
        cursor:situation&&!loading?"pointer":"not-allowed",
        display:"inline-flex", alignItems:"center", gap:8,
      }}>
        {loading?<><Spinner/>AI 판단 중...</>:"🤖 AI 판단 확인"}
      </button>

      {aiAnswer && (
        <>
          <div style={{
            background:`${roleInfo.color}08`, border:`1px solid ${roleInfo.color}25`,
            borderRadius:10, padding:"13px 15px", marginBottom:12,
          }}>
            <div style={{ fontSize:10, color:roleInfo.color, fontWeight:800, marginBottom:7 }}>
              {roleInfo.icon} {roleInfo.label}의 판단
            </div>
            <div style={{ fontSize:13, color:"#dde4f0", lineHeight:1.75, whiteSpace:"pre-wrap" }}>
              {aiAnswer}
            </div>
          </div>

          <textarea value={correction} onChange={e=>setCorrection(e.target.value)}
            placeholder="AI 판단이 맞으면 비워두세요. 틀렸다면 올바른 대응을 입력하세요."
            rows={2} style={{
              width:"100%", background:"rgba(4,8,15,0.8)",
              border:"1.5px solid rgba(249,115,22,0.25)", borderRadius:8,
              color:"#e2e8f0", padding:"9px 13px", fontSize:12.5, outline:"none",
              resize:"vertical", lineHeight:1.7, boxSizing:"border-box",
              fontFamily:"inherit", marginBottom:10,
            }}
          />

          <SaveBtn onClick={saveCase} saving={saving} saved={saved}/>
        </>
      )}

      {cases.length > 0 && (
        <div style={{ marginTop:24 }}>
          <div style={{ fontSize:10, color:"#374151", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
            📚 저장된 교정 사례 ({cases.length}건)
          </div>
          {[...cases].reverse().map((c,i) => (
            <div key={i} style={{
              background:"rgba(8,14,26,0.8)", border:"1px solid rgba(51,65,85,0.35)",
              borderRadius:8, padding:"11px 13px", marginBottom:8,
            }}>
              <div style={{ fontSize:11, color:"#64748b", marginBottom:4 }}>
                <span style={{ color:"#475569" }}>상황: </span>{c.situation.slice(0,60)}...
              </div>
              <div style={{ fontSize:11, color:"#64748b", marginBottom: c.correction ? 4 : 0 }}>
                <span style={{ color:roleInfo.color }}>AI: </span>{c.aiAnswer.slice(0,60)}...
              </div>
              {c.correction && (
                <div style={{ fontSize:11, color:"#fbbf24" }}>
                  <span style={{ color:"#f97316" }}>교정: </span>{c.correction}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 4: 문서·사진 학습 ──────────────────────────────────────────────────
function TabDocument({ role, roleInfo }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [analyzed, setAnalyzed] = useState("");
  const [category, setCategory] = useState("판단기준");
  const [imageType, setImageType] = useState(""); // 이미지 유형 (검사기준서/다이어그램/불량/설비/기타)
  const [recommendedCategory, setRecommendedCategory] = useState(""); // AI가 추천한 카테고리
  const [uploadedImageUrl, setUploadedImageUrl] = useState(""); // 드라이브 업로드된 이미지 URL

  // PDF 관련 (Step 5-B)
  const [pdfDoc, setPdfDoc] = useState(null);          // 로드된 PDF 객체
  const [pdfPageCount, setPdfPageCount] = useState(0); // 페이지 수
  const [pdfMode, setPdfMode] = useState("text");      // "text" | "vision"
  const [pdfImageUrls, setPdfImageUrls] = useState([]); // 페이지별 드라이브 URL
  const [loading, setLoading] = useState(false);
  const [analyzeStep, setAnalyzeStep] = useState(""); // 분석 진행 단계 표시
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [defectInfo, setDefectInfo] = useState({ count: 0, hasPattern: false }); // 불량 사진 누적 정보
  const fileRef = useRef();

  const CATEGORIES = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];
  const IMAGE_TYPES = ["검사 기준서", "공정 다이어그램", "불량 사진", "설비 사진", "기타"];
  const DEFECT_PATTERN_THRESHOLD = 10; // 불량 사진 N장 이상 누적 시 패턴 추출

  const isImage = file && file.type.startsWith("image/");
  const isPDF = file && file.type === "application/pdf";
  const isDoc = file && (file.name.endsWith(".docx") || file.name.endsWith(".doc"));
  const isExcel = file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"));

  // 시작 시 불량 사진 누적 카운트 로드
  useEffect(() => {
    (async () => {
      const info = await loadDefectImageCount(role);
      setDefectInfo(info);
    })();
  }, [role]);

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setAnalyzed("");
    setError("");
    setImageType("");
    setRecommendedCategory("");
    setUploadedImageUrl("");
    setPdfDoc(null);
    setPdfPageCount(0);
    setPdfImageUrls([]);
    setPdfMode("text");

    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview("");
    }

    // PDF면 페이지 수 자동 파악
    if (f.type === "application/pdf") {
      try {
        const pdf = await loadPdfDocument(f);
        setPdfDoc(pdf);
        setPdfPageCount(pdf.numPages);
      } catch (err) {
        setError(`PDF 로드 실패: ${err.message}`);
      }
    }
  };

  // 이미지 유형별 특화 프롬프트
  const getTypeSpecificPrompt = (detectedType) => {
    const baseRole = `당신은 ${roleInfo.label}(${role}) AI입니다.`;
    switch (detectedType) {
      case "검사 기준서":
        return `${baseRole}\n검사 기준서 이미지에서 다음을 정확히 추출하세요:\n- 검사 항목명 (각 항목)\n- 측정 위치 / 측정 방법\n- 규격값 (수치, 허용 오차 포함)\n- CTQ 여부\n표 형태가 있으면 표 구조를 살려서 정리.`;
      case "공정 다이어그램":
        return `${baseRole}\n공정 다이어그램에서 다음을 추출하세요:\n- 공정 단계 순서 (좌→우 또는 위→아래)\n- 각 단계의 명칭과 역할\n- 단계 간 연결 관계 / 분기 / 피드백 루프\n- 표시된 주요 변수나 조건`;
      case "불량 사진":
        return `${baseRole}\n불량 현상 사진에서 다음을 추출하세요:\n- 불량의 시각적 특징 (색상, 형태, 위치, 크기)\n- 불량 발생 부위 (제품의 어느 부분)\n- 추정 원인 (시각적 단서 기반)\n- 분류 가능한 불량 유형 (예: 스크래치, 변색, 누액, 변형 등)`;
      case "설비 사진":
        return `${baseRole}\n설비 사진에서 다음을 추출하세요:\n- 설비 종류 / 명칭 (식별 가능한 경우)\n- 주요 부품 또는 구조\n- 라벨, 표시판, 게이지 표시값\n- 설비 상태 (정상/이상 신호 있는지)`;
      default:
        return `${baseRole}\n업로드된 이미지에서 ${role} 업무 관련 핵심 내용을 추출하세요.\n한국어로 간결하게 정리.`;
    }
  };

  // AI에게 이미지 유형 자동 판단 요청
  const detectImageType = async (base64, mediaType) => {
    const sys = `당신은 이미지 분류기입니다. 업로드된 이미지가 다음 중 어느 유형인지 판단하세요.
- 검사 기준서: 표/다이어그램으로 검사 항목과 규격이 정리된 문서
- 공정 다이어그램: 공정 흐름이나 시스템 구조를 보여주는 도식
- 불량 사진: 제품의 불량/이상 현상을 찍은 사진
- 설비 사진: 공장 설비, 기계, 장비를 찍은 사진
- 기타: 위에 해당하지 않음

또한 이 이미지가 다음 카테고리 중 어디에 가장 잘 맞는지 추천하세요:
- 공장정보, 업무역할, 판단기준, 협업방식, 교정사례

JSON으로만 답하세요. 다른 설명 없이.

응답 형식:
{"imageType":"검사 기준서|공정 다이어그램|불량 사진|설비 사진|기타","recommendedCategory":"공장정보|업무역할|판단기준|협업방식|교정사례","reason":"한 줄 사유"}`;

    try {
      const raw = await callClaudeVision(sys, "이 이미지를 분류하세요.", base64, mediaType);
      const parsed = safeJSON(raw);
      return {
        imageType: parsed.imageType || "기타",
        recommendedCategory: parsed.recommendedCategory || "판단기준",
      };
    } catch {
      return { imageType: "기타", recommendedCategory: "판단기준" };
    }
  };

  const analyze = async () => {
    if (!file) return;
    setLoading(true);
    setError("");
    setAnalyzed("");
    setImageType("");
    setRecommendedCategory("");
    setUploadedImageUrl("");

    try {
      let result = "";
      let detectedType = "";

      if (isImage) {
        const base64 = await fileToBase64(file);
        // 압축된 이미지는 항상 JPEG로 재인코딩됨
        const mediaType = "image/jpeg";

        // 압축 후 크기 표시 (디버깅 + 사용자 안내용)
        const compressedKB = estimateBase64Size(base64);
        console.log(`이미지 압축 완료: ${compressedKB}KB`);

        // 1단계: 이미지 유형 자동 판단
        setAnalyzeStep("이미지 유형 분석 중...");
        const detection = await detectImageType(base64, mediaType);
        detectedType = detection.imageType;
        setImageType(detectedType);
        setRecommendedCategory(detection.recommendedCategory);
        setCategory(detection.recommendedCategory); // 카테고리 자동 설정

        // 2단계: 유형별 특화 프롬프트로 분석
        setAnalyzeStep(`${detectedType} 분석 중...`);
        const specificPrompt = getTypeSpecificPrompt(detectedType);

        // 시각 메타데이터 + 추출 텍스트를 한꺼번에 요청
        const analysisPrompt = `${specificPrompt}

다음 형식으로 한국어 답변:
[추출 텍스트]
(이미지에서 읽거나 추론한 정보, 핵심만 간결하게)

[시각 설명]
(이미지의 시각적 특징을 한 줄로: 레이아웃, 색상, 강조 표시 등)`;

        result = await callClaudeVision(
          analysisPrompt,
          `이 ${detectedType} 이미지를 분석하세요.`,
          base64,
          mediaType
        );

        // 3단계: 드라이브에 이미지 업로드 (백그라운드 진행, 실패해도 분석은 유지)
        setAnalyzeStep("드라이브 저장 중...");
        let imageUrl = "";
        try {
          const uploadResult = await uploadImageToDrive(role, file.name, base64, mediaType);
          if (uploadResult && uploadResult.url) {
            imageUrl = uploadResult.url;
            setUploadedImageUrl(imageUrl);
          }
        } catch (e) {
          console.error("드라이브 업로드 실패 (분석은 계속 진행):", e);
        }

        // 메타데이터 추가 (URL 있으면 포함)
        const urlLine = imageUrl ? `[이미지URL] ${imageUrl}\n` : "";
        result = `${urlLine}[이미지 유형] ${detectedType}\n${result}`;
      } else if (isPDF && pdfDoc) {
        // ─── PDF 처리 (Step 5-B) ───
        if (pdfMode === "text") {
          // 텍스트 추출 모드
          setAnalyzeStep(`PDF 텍스트 추출 중 (${pdfPageCount}페이지)...`);
          const fullText = await extractPdfText(pdfDoc);

          if (!fullText || fullText.trim().length < 50) {
            // 텍스트 추출 실패 = 스캔 PDF 가능성
            throw new Error("텍스트 추출이 거의 안 되었습니다. 스캔 PDF로 보입니다. '그림 분석' 모드로 다시 시도하세요.");
          }

          setAnalyzeStep("AI 분석 중...");
          const sys = `${roleInfo.label}(${role}) AI입니다. PDF에서 추출한 텍스트입니다.
카테고리: ${category}
한국어로 핵심 내용만 간결하게 정리. 500자 이내.
표/구조가 있으면 살려서 정리하세요.`;
          const truncated = fullText.slice(0, 12000); // 너무 길면 자르기
          result = await callClaude(sys, `다음 PDF 내용에서 핵심을 추출하세요:\n\n${truncated}`);

          result = `[PDF: ${file.name} - 텍스트 추출, ${pdfPageCount}페이지]\n${result}`;
        } else {
          // 그림 분석 모드 - 페이지별 이미지 변환 후 Vision API
          const allResults = [];
          const pageUrls = [];

          for (let pageNum = 1; pageNum <= pdfPageCount; pageNum++) {
            setAnalyzeStep(`페이지 ${pageNum}/${pdfPageCount} 분석 중...`);

            // 1단계: 페이지를 base64 이미지로 변환
            const pageBase64 = await pdfPageToBase64(pdfDoc, pageNum);

            // 2단계: 드라이브에 업로드 (백그라운드)
            const pageFilename = `${file.name.replace(/\.pdf$/i, "")}_p${pageNum}.jpg`;
            let pageUrl = "";
            try {
              const uploadResult = await uploadImageToDrive(role, pageFilename, pageBase64, "image/jpeg");
              if (uploadResult && uploadResult.url) {
                pageUrl = uploadResult.url;
              }
            } catch (e) {
              console.error(`페이지 ${pageNum} 드라이브 업로드 실패:`, e);
            }
            pageUrls.push(pageUrl);

            // 3단계: Vision API로 분석
            const pagePrompt = `${roleInfo.label}(${role}) AI입니다. PDF 페이지 ${pageNum}/${pdfPageCount} 분석.
카테고리: ${category}
다음 형식으로 한국어 답변 (200자 이내):
[추출 텍스트] (페이지 핵심 내용)
[시각 설명] (레이아웃, 표, 다이어그램 등 시각 요소)`;

            try {
              const pageResult = await callClaudeVision(
                pagePrompt,
                `이 PDF 페이지를 분석하세요.`,
                pageBase64,
                "image/jpeg"
              );
              allResults.push(`━━ 페이지 ${pageNum} ━━\n${pageResult}`);
            } catch (e) {
              allResults.push(`━━ 페이지 ${pageNum} ━━\n(분석 실패: ${e.message})`);
            }
          }

          setPdfImageUrls(pageUrls);

          // 4단계: 페이지별 결과를 하나로 종합
          setAnalyzeStep("종합 분석 중...");
          const combinedText = allResults.join("\n\n");
          const sumSys = `위 페이지별 분석 결과들을 종합해서 PDF 전체의 핵심을 ${roleInfo.label}(${role}) 관점에서 한국어 500자 이내로 정리하세요.`;
          const summary = await callClaude(sumSys, combinedText);

          // URL 목록 라인
          const urlLines = pageUrls
            .map((u, i) => u ? `[페이지${i+1}URL] ${u}` : `[페이지${i+1}URL] (업로드 실패)`)
            .join("\n");

          result = `[PDF: ${file.name} - 그림 분석, ${pdfPageCount}페이지]\n${urlLines}\n\n[종합 요약]\n${summary}\n\n[페이지별 상세]\n${combinedText}`;
        }
      } else {
        // 텍스트 파일 처리 (기존 그대로)
        setAnalyzeStep("파일 분석 중...");
        const sys = `${roleInfo.label}(${role}) AI입니다. 카테고리: ${category}.\n한국어로 핵심 내용만 간결하게 정리. 200자 이내.`;
        let text = await extractTextFromFile(file);
        if (!text || text.length < 10) text = `파일명: ${file.name}`;
        const truncated = text.slice(0, 2000);
        result = await callClaude(sys, `다음 내용에서 핵심을 추출하세요:\n${truncated}`);
      }

      setAnalyzed(result);
    } catch(e) {
      setError(`분석 실패: ${e.message}`);
    } finally {
      setLoading(false);
      setAnalyzeStep("");
    }
  };

  const [conflictQueue, setConflictQueue] = useState([]);
  const [currentConflict, setCurrentConflict] = useState(null);

  useEffect(() => {
    if (!currentConflict && conflictQueue.length > 0) {
      setCurrentConflict(conflictQueue[0]);
      setConflictQueue(q => q.slice(1));
    }
  }, [conflictQueue, currentConflict]);

  const handleConflictResolve = async () => {
    setCurrentConflict(null);
  };

  // 불량 사진 패턴 추출 (10장 이상 누적 시 자동 트리거)
  const extractDefectPattern = async () => {
    try {
      const data = await loadDefectImageData(role);
      if (data.length === 0) return;

      const dataText = data.map((d, i) =>
        `${i + 1}. ${d.content.replace(/\[파일: [^\]]+\]/g, '').slice(0, 300)}`
      ).join("\n\n");

      const sys = `당신은 불량 패턴 분석 전문가입니다. 아래 ${data.length}장의 불량 사진 분석 결과들을 보고 공통된 패턴을 일반화해서 추출하세요.

[불량 사진 분석 결과들]
${dataText.slice(0, 8000)}

다음 형식으로 한국어 요약 작성:
[자주 발생하는 불량 유형] (Top 3)
[공통 발생 부위]
[추정 공통 원인]
[권장 점검 포인트]

전체 500자 이내로 간결하게.`;

      const pattern = await callClaude(sys, "불량 패턴을 일반화하세요.");
      await saveDefectPattern(role, pattern);

      // UI 갱신
      const info = await loadDefectImageCount(role);
      setDefectInfo(info);
    } catch (e) {
      console.error("불량 패턴 추출 실패:", e);
    }
  };

  const save = async () => {
    if (!analyzed) return;
    setSaving(true);
    try {
      const contentToSave = `[파일: ${file.name}] ${analyzed}`;

      // 충돌 검사
      const conflict = await checkConflict(role, category, contentToSave);
      if (conflict) {
        setConflictQueue([{ category, content: contentToSave, conflict }]);
      } else {
        await saveToSheet(role, category, contentToSave);

        // 불량 사진이고 누적 임계 도달 시 패턴 추출 (백그라운드)
        if (imageType === "불량 사진") {
          const newCount = (defectInfo.count || 0) + 1;
          if (newCount >= DEFECT_PATTERN_THRESHOLD && newCount % DEFECT_PATTERN_THRESHOLD === 0) {
            extractDefectPattern(); // await 안 함
          }
          setDefectInfo({ ...defectInfo, count: newCount });
        }

        // 정상 저장 완료 → 다음 파일 업로드를 위해 모든 입력 초기화
        // (충돌 분기로 들어간 경우는 사용자가 충돌 해결 후 결정해야 하므로 초기화하지 않음)
        if (preview) URL.revokeObjectURL(preview); // 메모리 누수 방지
        setFile(null);
        setPreview("");
        setAnalyzed("");
        setImageType("");
        setRecommendedCategory("");
        setUploadedImageUrl("");
        setPdfDoc(null);
        setPdfPageCount(0);
        setPdfImageUrls([]);
        setPdfMode("text");
        setError("");
        if (fileRef.current) fileRef.current.value = "";  // 같은 파일 재업로드 가능하게 input 초기화
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError("저장 실패"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>📄 문서·사진 학습</div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          PDF, Word, Excel, 사진 파일을 업로드하면 AI가 핵심 내용을 추출해요
        </div>
      </div>

      {/* 지원 형식 */}
      <div style={{ display:"flex", gap:6, marginBottom:8, flexWrap:"wrap" }}>
        {[
          { label:"PDF", color:"#ef4444" },
          { label:"JPG/PNG", color:"#f97316" },
          { label:"TXT/CSV", color:"#a78bfa" },
        ].map(t => (
          <span key={t.label} style={{
            background:`${t.color}15`, border:`1px solid ${t.color}30`,
            color:t.color, borderRadius:5, padding:"2px 10px",
            fontSize:10, fontWeight:800,
          }}>{t.label}</span>
        ))}
      </div>

      {/* Word/Excel 미지원 안내 */}
      <div style={{
        fontSize:10, color:"#64748b", marginBottom:14, lineHeight:1.5,
        padding:"6px 10px", background:"rgba(15,23,42,0.5)",
        border:"1px solid rgba(51,65,85,0.3)", borderRadius:6,
      }}>
        💡 Word/Excel은 PDF로 변환 후 업로드해주세요 (파일 → 다른 이름으로 저장 → PDF)
      </div>

      {/* 파일 업로드 */}
      <div onClick={() => fileRef.current?.click()} style={{
        border:`2px dashed ${file ? roleInfo.color : "rgba(71,85,105,0.6)"}`,
        borderRadius:12, padding:"28px 20px", textAlign:"center",
        cursor:"pointer", marginBottom:14,
        background: file ? `${roleInfo.color}05` : "rgba(15,23,42,0.4)",
        transition:"all 0.2s",
      }}>
        <input ref={fileRef} type="file"
          accept=".pdf,.txt,.csv,.md,.jpg,.jpeg,.png"
          onChange={handleFile} style={{ display:"none" }}/>
        {preview ? (
          <img src={preview} alt="미리보기"
            style={{ maxHeight:150, maxWidth:"100%", borderRadius:8, marginBottom:8 }}/>
        ) : (
          <div style={{ fontSize:36, marginBottom:8 }}>{file ? "📄" : "📂"}</div>
        )}
        {file ? (
          <>
            <div style={{ fontSize:13, color:roleInfo.color, fontWeight:700 }}>{file.name}</div>
            <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>
              {(file.size/1024).toFixed(1)}KB · 클릭하여 변경
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize:13, color:"#94a3b8" }}>클릭하여 파일 선택</div>
            <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>PDF, Word, Excel, 사진</div>
          </>
        )}
      </div>

      {/* 불량 사진 누적 정보 */}
      {defectInfo.count > 0 && (
        <div style={{
          background: defectInfo.hasPattern ? "rgba(52,211,153,0.06)" : "rgba(245,158,11,0.06)",
          border: `1px solid ${defectInfo.hasPattern ? "rgba(52,211,153,0.25)" : "rgba(245,158,11,0.25)"}`,
          borderRadius:8, padding:"9px 13px", marginBottom:12,
          fontSize:11, color:"#94a3b8", lineHeight:1.6,
        }}>
          <span style={{ color: defectInfo.hasPattern ? "#34d399" : "#fbbf24", fontWeight:700 }}>
            {defectInfo.hasPattern ? "✅ 불량 패턴 학습됨" : `📸 불량 사진 ${defectInfo.count}장 누적`}
          </span>
          {!defectInfo.hasPattern && defectInfo.count < DEFECT_PATTERN_THRESHOLD && (
            <span> · {DEFECT_PATTERN_THRESHOLD - defectInfo.count}장 더 모이면 자동 패턴 추출</span>
          )}
        </div>
      )}

      {/* PDF 모드 선택 (Step 5-B) */}
      {isPDF && pdfPageCount > 0 && (
        <div style={{
          background:"rgba(15,23,42,0.6)",
          border:`1px solid ${roleInfo.color}30`,
          borderRadius:10, padding:"14px 16px", marginBottom:12,
        }}>
          <div style={{ fontSize:12, color:"#cbd5e1", fontWeight:700, marginBottom:4 }}>
            📄 PDF 분석 방식 선택
          </div>
          <div style={{ fontSize:10.5, color:"#64748b", marginBottom:10 }}>
            {pdfPageCount}페이지 · {(file.size/1024).toFixed(0)}KB
            {pdfPageCount > 30 && (
              <span style={{ color:"#fbbf24", marginLeft:6, fontWeight:700 }}>
                ⚠️ 페이지 수가 많습니다
              </span>
            )}
          </div>

          {/* 옵션 2개 */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {/* 텍스트 추출 */}
            <div onClick={() => setPdfMode("text")} style={{
              padding:"10px 12px", cursor:"pointer",
              background: pdfMode === "text" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
              border: `1.5px solid ${pdfMode === "text" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
              borderRadius:8, transition:"all 0.15s",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                <div style={{
                  width:14, height:14, borderRadius:"50%",
                  border:`2px solid ${pdfMode === "text" ? roleInfo.color : "#475569"}`,
                  background: pdfMode === "text" ? roleInfo.color : "transparent",
                }}/>
                <span style={{ fontSize:11.5, fontWeight:700,
                  color: pdfMode === "text" ? roleInfo.color : "#94a3b8" }}>
                  📝 텍스트 추출
                </span>
              </div>
              <div style={{ fontSize:10, color:"#64748b", lineHeight:1.5 }}>
                {calcTextExtractCost(pdfPageCount).label}
                <br/>
                ⚡ {estimateTime(pdfPageCount, "text")} · 전체 페이지
                <br/>
                <span style={{ color:"#34d399" }}>✓ 텍스트 PDF에 적합</span>
                <br/>
                <span style={{ color:"#f87171" }}>✗ 그림/표 시각 정보 손실</span>
              </div>
            </div>

            {/* 그림 분석 */}
            <div onClick={() => setPdfMode("vision")} style={{
              padding:"10px 12px", cursor:"pointer",
              background: pdfMode === "vision" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
              border: `1.5px solid ${pdfMode === "vision" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
              borderRadius:8, transition:"all 0.15s",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:4 }}>
                <div style={{
                  width:14, height:14, borderRadius:"50%",
                  border:`2px solid ${pdfMode === "vision" ? roleInfo.color : "#475569"}`,
                  background: pdfMode === "vision" ? roleInfo.color : "transparent",
                }}/>
                <span style={{ fontSize:11.5, fontWeight:700,
                  color: pdfMode === "vision" ? roleInfo.color : "#94a3b8" }}>
                  🖼️ 그림 분석
                </span>
              </div>
              <div style={{ fontSize:10, color:"#64748b", lineHeight:1.5 }}>
                {calcVisionCost(pdfPageCount).label}
                <br/>
                ⏱️ {estimateTime(pdfPageCount, "vision")} · 전체 페이지
                <br/>
                <span style={{ color:"#34d399" }}>✓ 시각 정보 보존, 스캔 PDF OK</span>
                <br/>
                <span style={{ color:"#34d399" }}>✓ 페이지별 드라이브 저장</span>
              </div>
            </div>
          </div>

          {pdfPageCount > 30 && pdfMode === "vision" && (
            <div style={{
              marginTop:8, padding:"7px 10px",
              background:"rgba(251,191,36,0.08)",
              border:"1px solid rgba(251,191,36,0.3)",
              borderRadius:6, fontSize:10.5, color:"#fbbf24",
            }}>
              ⚠️ {pdfPageCount}페이지 그림 분석 시 비용이 큽니다. 텍스트 추출 모드가 가능하면 그쪽을 권장합니다.
            </div>
          )}
        </div>
      )}

      {/* 이미지 유형 자동 판단 결과 표시 */}
      {imageType && (
        <div style={{
          background:`${roleInfo.color}06`, border:`1px solid ${roleInfo.color}25`,
          borderRadius:8, padding:"10px 13px", marginBottom:12,
        }}>
          <div style={{ fontSize:10, color:roleInfo.color, fontWeight:800, marginBottom:4 }}>
            🎯 AI 자동 판단
          </div>
          <div style={{ fontSize:12, color:"#cbd5e1" }}>
            <strong>이미지 유형:</strong> {imageType}
            {recommendedCategory && (
              <> · <strong>추천 카테고리:</strong> {recommendedCategory}</>
            )}
          </div>
          {recommendedCategory && recommendedCategory !== category && (
            <div style={{ fontSize:10, color:"#fbbf24", marginTop:4 }}>
              ⚠️ 카테고리를 변경하셨습니다 (자동 추천: {recommendedCategory})
            </div>
          )}
        </div>
      )}

      {/* 카테고리 선택 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:10, color:"#475569", fontWeight:800, letterSpacing:1.2, marginBottom:6 }}>
          저장 카테고리 {recommendedCategory && <span style={{ color:roleInfo.color, marginLeft:4 }}>(AI 추천: {recommendedCategory})</span>}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {CATEGORIES.map(cat => (
            <button key={cat} onClick={() => setCategory(cat)} style={{
              padding:"5px 12px",
              background: category===cat ? `${roleInfo.color}20` : "rgba(30,41,59,0.6)",
              border:`1px solid ${category===cat ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
              borderRadius:6, color: category===cat ? roleInfo.color : "#64748b",
              fontSize:11, fontWeight:700, cursor:"pointer",
            }}>{cat}</button>
          ))}
        </div>
      </div>

      {/* 분석 버튼 */}
      <button onClick={analyze} disabled={!file || loading} style={{
        padding:"10px 18px", marginBottom:14,
        background: file&&!loading ? `linear-gradient(135deg,${roleInfo.color},${roleInfo.color}99)` : "rgba(51,65,85,0.3)",
        border:"none", borderRadius:8,
        color: file&&!loading ? "#fff" : "#374151",
        fontSize:13, fontWeight:700,
        cursor: file&&!loading ? "pointer" : "not-allowed",
        display:"inline-flex", alignItems:"center", gap:8,
      }}>
        {loading ? <><Spinner/>{analyzeStep || "분석 중..."}</> : "🔍 AI 분석"}
      </button>

      {error && (
        <div style={{
          padding:"9px 13px", background:"rgba(239,68,68,0.08)",
          border:"1px solid rgba(239,68,68,0.25)", borderRadius:8,
          fontSize:11, color:"#fca5a5", marginBottom:12,
        }}>{error}</div>
      )}

      {/* 분석 결과 */}
      {analyzed && (
        <div style={{ marginBottom:14 }}>
          <div style={{
            background:`${roleInfo.color}06`, border:`1px solid ${roleInfo.color}25`,
            borderRadius:10, padding:"13px 15px", marginBottom:10,
          }}>
            <div style={{ fontSize:10, color:roleInfo.color, fontWeight:800, marginBottom:7 }}>
              🤖 AI 분석 결과 ({category})
            </div>
            <textarea
              value={analyzed}
              onChange={e => setAnalyzed(e.target.value)}
              rows={4}
              style={{
                width:"100%", background:"transparent",
                border:"none", color:"#dde4f0",
                fontSize:12.5, lineHeight:1.75, outline:"none",
                resize:"vertical", fontFamily:"inherit",
                boxSizing:"border-box",
              }}
            />
            <div style={{ fontSize:9, color:"#374151", marginTop:4 }}>
              내용을 직접 수정할 수 있어요
            </div>
          </div>

          {/* 드라이브 업로드 상태 (이미지인 경우만) */}
          {isImage && (
            <div style={{
              background: uploadedImageUrl ? "rgba(52,211,153,0.06)" : "rgba(239,68,68,0.06)",
              border: `1px solid ${uploadedImageUrl ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.25)"}`,
              borderRadius:8, padding:"9px 13px", marginBottom:10,
              fontSize:11, lineHeight:1.6,
            }}>
              {uploadedImageUrl ? (
                <>
                  <span style={{ color:"#34d399", fontWeight:700 }}>✅ 드라이브에 저장됨</span>
                  <a href={uploadedImageUrl} target="_blank" rel="noopener noreferrer" style={{
                    color:"#93c5fd", marginLeft:8, fontSize:10.5, textDecoration:"underline",
                  }}>
                    🔗 원본 이미지 보기
                  </a>
                </>
              ) : (
                <>
                  <span style={{ color:"#fca5a5", fontWeight:700 }}>⚠️ 드라이브 업로드 실패</span>
                  <span style={{ color:"#94a3b8", marginLeft:6, fontSize:10.5 }}>
                    (분석 결과는 그대로 저장되며, URL만 누락됨)
                  </span>
                </>
              )}
            </div>
          )}

          <SaveBtn onClick={save} saving={saving} saved={saved}/>
        </div>
      )}

      {currentConflict && (
        <ConflictDialog
          role={role}
          category={currentConflict.category}
          newContent={currentConflict.content}
          conflict={currentConflict.conflict}
          onResolve={handleConflictResolve}
          onCancel={handleConflictResolve}
        />
      )}
    </div>
  );
}

// ─── STEP 5: 학습 현황 ────────────────────────────────────────────────────────
function TabStatus({ role, roleInfo, knowledge, onReload, loading }) {
  const progress = calcProgress(knowledge);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState(null); // { conflicts: [...], scannedAt: timestamp }
  const [resolving, setResolving] = useState(null); // 현재 처리 중인 충돌 인덱스

  const CATEGORIES_TO_SCAN = ["공장정보", "업무역할", "판단기준", "협업방식", "교정사례"];

  // 카테고리별 풀 검사 (Step 3 수동 검사)
  const startFullScan = async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const allConflicts = [];

      for (const category of CATEGORIES_TO_SCAN) {
        const items = knowledge.filter(k => k.category === category);
        if (items.length < 2) continue; // 비교할 데이터 부족

        // 너무 많으면 최근 30건까지만
        const targets = items.slice(-30);
        const targetsText = targets.map((it, i) => `${i + 1}. ${it.content}`).join("\n");

        const sys = `당신은 학습 데이터 검증자입니다. 아래 ${category} 카테고리 항목들 중 서로 중복(같은 의미)이거나 충돌(같은 주제이지만 내용 다름)하는 쌍을 찾아주세요.

[항목들]
${targetsText}

[판단 기준]
- duplicate: 같은 의미를 다른 표현으로 작성
- conflict: 같은 주제인데 수치/절차/기준이 다름

JSON으로만 답하세요. 충돌 없으면 빈 배열.

응답 형식:
{"pairs":[{"a":1,"b":3,"type":"duplicate|conflict","reason":"한 줄 사유"}]}`;

        try {
          const raw = await callClaude(sys, "검사 결과를 JSON으로 답하세요.");
          const parsed = safeJSON(raw);

          if (parsed.pairs && Array.isArray(parsed.pairs)) {
            for (const pair of parsed.pairs) {
              if (pair.a >= 1 && pair.a <= targets.length &&
                  pair.b >= 1 && pair.b <= targets.length && pair.a !== pair.b) {
                allConflicts.push({
                  category,
                  itemA: targets[pair.a - 1],
                  itemB: targets[pair.b - 1],
                  type: pair.type || "conflict",
                  reason: pair.reason || "",
                  resolved: false,
                });
              }
            }
          }
        } catch {
          // 카테고리별 검사 실패해도 다음 진행
          continue;
        }
      }

      setScanResults({
        conflicts: allConflicts,
        scannedAt: new Date().toLocaleTimeString("ko-KR"),
      });
    } catch (e) {
      alert("검사 실패: " + e.message);
    } finally {
      setScanning(false);
    }
  };

  // 충돌 해결 처리 (A 유지 / B 유지 / 둘 다 / 건너뛰기)
  const resolveConflict = async (idx, choice) => {
    setResolving(idx);
    try {
      const c = scanResults.conflicts[idx];
      if (choice === "keep_a") {
        // A 유지 → B 삭제
        await deleteKnowledge(role, c.category, c.itemB.content);
      } else if (choice === "keep_b") {
        // B 유지 → A 삭제
        await deleteKnowledge(role, c.category, c.itemA.content);
      }
      // keep_both / skip은 둘 다 유지 (아무것도 안 함)

      // 해당 항목 처리됨 표시
      setScanResults(r => ({
        ...r,
        conflicts: r.conflicts.map((cf, i) =>
          i === idx ? { ...cf, resolved: true, resolvedAs: choice } : cf
        ),
      }));
    } catch (e) {
      alert("처리 실패: " + e.message);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:15, fontWeight:800, color:"#f1f5f9" }}>🧠 학습 현황</div>
        <div style={{ fontSize:11, color:"#475569", marginTop:3 }}>
          구글 시트에 저장된 학습 내용 및 수준
        </div>
      </div>

      {/* 전체 학습도 */}
      <div style={{
        background:`${roleInfo.color}08`, border:`1px solid ${roleInfo.color}25`,
        borderRadius:12, padding:"16px 18px", marginBottom:16, textAlign:"center",
      }}>
        <div style={{ fontSize:36, fontWeight:900, color:roleInfo.color, marginBottom:4 }}>
          {progress["전체"]}%
        </div>
        <div style={{ fontSize:11, color:"#64748b" }}>{roleInfo.label} 전체 학습도</div>
      </div>

      {/* 항목별 */}
      {["공장정보","업무역할","판단기준","협업방식","교정사례"].map(cat => (
        <ProgressBar key={cat} label={cat} value={progress[cat]||0} color={roleInfo.color}/>
      ))}

      <button onClick={onReload} disabled={loading} style={{
        width:"100%", padding:"10px", marginTop:8,
        background:"rgba(51,65,85,0.3)", border:"1px solid rgba(51,65,85,0.4)",
        borderRadius:8, color:"#64748b", fontSize:12, cursor:"pointer",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8,
      }}>
        {loading ? <><Spinner/>로딩 중...</> : "🔄 최신 데이터 불러오기"}
      </button>

      {/* 데이터 정리 (풀 검사) */}
      <div style={{
        marginTop:18, padding:"14px 16px",
        background:"rgba(167,139,250,0.05)",
        border:"1px solid rgba(167,139,250,0.2)",
        borderRadius:10,
      }}>
        <div style={{ fontSize:13, fontWeight:700, color:"#cbd5e1", marginBottom:4 }}>
          🔍 학습 데이터 정리
        </div>
        <div style={{ fontSize:10.5, color:"#64748b", marginBottom:10, lineHeight:1.6 }}>
          카테고리별 중복/충돌을 한꺼번에 검토합니다. (약 30초~1분 소요)
        </div>
        <button onClick={startFullScan} disabled={scanning || knowledge.length < 2} style={{
          width:"100%", padding:"10px",
          background: scanning || knowledge.length < 2 ? "rgba(51,65,85,0.3)" : "linear-gradient(135deg,#a78bfa,#7c3aed)",
          border:"none", borderRadius:8,
          color: scanning || knowledge.length < 2 ? "#475569" : "#fff",
          fontSize:12, fontWeight:700,
          cursor: scanning || knowledge.length < 2 ? "not-allowed" : "pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        }}>
          {scanning ? <><Spinner/>검사 중...</> : "🔎 전체 검사 시작"}
        </button>

        {/* 검사 결과 표시 */}
        {scanResults && (
          <div style={{ marginTop:14 }}>
            <div style={{ fontSize:11, color:"#94a3b8", marginBottom:10 }}>
              {scanResults.conflicts.length === 0
                ? `✅ 검사 완료 (${scanResults.scannedAt}) — 정리할 항목 없음`
                : `⚠️ ${scanResults.conflicts.length}쌍의 중복/충돌 발견 (${scanResults.scannedAt})`
              }
            </div>

            {scanResults.conflicts.map((c, idx) => (
              <div key={idx} style={{
                background:"rgba(15,23,42,0.6)",
                border:`1px solid ${c.resolved ? "rgba(52,211,153,0.4)" : "rgba(245,158,11,0.3)"}`,
                borderRadius:8, padding:"12px 14px", marginBottom:10,
                opacity: c.resolved ? 0.6 : 1,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                  <span style={{
                    background: c.type === "duplicate" ? "rgba(167,139,250,0.2)" : "rgba(245,158,11,0.2)",
                    color: c.type === "duplicate" ? "#a78bfa" : "#fbbf24",
                    padding:"2px 7px", borderRadius:4, fontSize:9, fontWeight:800,
                  }}>{c.type === "duplicate" ? "중복" : "충돌"}</span>
                  <span style={{ fontSize:10, color:"#64748b" }}>{c.category}</span>
                  {c.resolved && (
                    <span style={{ marginLeft:"auto", fontSize:10, color:"#34d399", fontWeight:700 }}>
                      ✓ 처리됨 ({c.resolvedAs === "keep_a" ? "A 유지" :
                                c.resolvedAs === "keep_b" ? "B 유지" :
                                c.resolvedAs === "keep_both" ? "둘 다" : "건너뜀"})
                    </span>
                  )}
                </div>

                {c.reason && (
                  <div style={{ fontSize:10.5, color:"#94a3b8", marginBottom:8, fontStyle:"italic" }}>
                    {c.reason}
                  </div>
                )}

                <div style={{ marginBottom:6 }}>
                  <div style={{ fontSize:9.5, color:"#64748b", fontWeight:700, marginBottom:3 }}>A</div>
                  <div style={{
                    background:"rgba(8,14,26,0.6)", padding:"7px 10px",
                    borderRadius:5, fontSize:11, color:"#cbd5e1", lineHeight:1.5,
                  }}>{c.itemA.content}</div>
                </div>
                <div style={{ marginBottom: c.resolved ? 0 : 10 }}>
                  <div style={{ fontSize:9.5, color:"#64748b", fontWeight:700, marginBottom:3 }}>B</div>
                  <div style={{
                    background:"rgba(8,14,26,0.6)", padding:"7px 10px",
                    borderRadius:5, fontSize:11, color:"#cbd5e1", lineHeight:1.5,
                  }}>{c.itemB.content}</div>
                </div>

                {!c.resolved && (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:5 }}>
                    <button onClick={() => resolveConflict(idx, "keep_a")}
                      disabled={resolving === idx} style={smallBtnStyle("#34d399")}>
                      A 유지
                    </button>
                    <button onClick={() => resolveConflict(idx, "keep_b")}
                      disabled={resolving === idx} style={smallBtnStyle("#3b82f6")}>
                      B 유지
                    </button>
                    <button onClick={() => resolveConflict(idx, "keep_both")}
                      disabled={resolving === idx} style={smallBtnStyle("#a78bfa")}>
                      둘 다 유지
                    </button>
                    <button onClick={() => resolveConflict(idx, "skip")}
                      disabled={resolving === idx} style={smallBtnStyle("#64748b")}>
                      건너뛰기
                    </button>
                  </div>
                )}
              </div>
            ))}

            {scanResults.conflicts.length > 0 && (
              <div style={{ fontSize:10, color:"#64748b", marginTop:6, textAlign:"center" }}>
                💡 처리 후 "최신 데이터 불러오기"로 새로고침하세요
              </div>
            )}
          </div>
        )}
      </div>

      {/* 저장된 내용 */}
      {knowledge.length > 0 && (
        <div style={{ marginTop:20 }}>
          <div style={{ fontSize:10, color:"#374151", fontWeight:700, letterSpacing:1, marginBottom:10 }}>
            📋 저장된 학습 내용 ({knowledge.length}건)
          </div>
          {knowledge.map((k,i) => {
            // [이미지URL] https://... 패턴 추출
            const urlMatch = k.content && k.content.match(/\[이미지URL\]\s*(https?:\/\/[^\s\n]+)/);
            const imageUrl = urlMatch ? urlMatch[1] : null;
            // URL 라인을 제외한 나머지 텍스트 (가독성을 위해)
            const contentWithoutUrl = imageUrl
              ? k.content.replace(/\[이미지URL\]\s*https?:\/\/[^\s\n]+\n?/, "")
              : k.content;

            return (
              <div key={i} style={{
                background:"rgba(8,14,26,0.7)", border:"1px solid rgba(51,65,85,0.3)",
                borderRadius:8, padding:"10px 13px", marginBottom:7,
              }}>
                <div style={{
                  display:"flex", alignItems:"center", gap:8, marginBottom:4,
                }}>
                  <div style={{ fontSize:10, color:roleInfo.color, fontWeight:700 }}>
                    {k.category}
                  </div>
                  {imageUrl && (
                    <a href={imageUrl} target="_blank" rel="noopener noreferrer" style={{
                      fontSize:10, color:"#93c5fd", textDecoration:"none",
                      background:"rgba(59,130,246,0.12)", padding:"2px 7px",
                      borderRadius:4, border:"1px solid rgba(59,130,246,0.25)",
                    }}>
                      🖼️ 이미지 보기
                    </a>
                  )}
                </div>
                <div style={{ fontSize:11.5, color:"#94a3b8", lineHeight:1.6,
                  whiteSpace:"pre-wrap" }}>
                  {contentWithoutUrl}
                </div>
                <div style={{ fontSize:9.5, color:"#374151", marginTop:4 }}>{k.updated_at}</div>
              </div>
            );
          })}
        </div>
      )}

      {knowledge.length === 0 && !loading && (
        <div style={{ textAlign:"center", padding:"30px 0", color:"#374151" }}>
          <div style={{ fontSize:32, marginBottom:8 }}>📭</div>
          <div style={{ fontSize:12 }}>아직 학습된 내용이 없어요</div>
          <div style={{ fontSize:10, marginTop:4 }}>STEP 1~3을 진행하면 여기에 쌓입니다</div>
        </div>
      )}
    </div>
  );
}

// ─── 전체 학습 대시보드 (에이전트 선택 화면용) ────────────────────────────────
function HomeDashboard() {
  const [data, setData] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const raw = await loadAllProgress();
      if (raw.length === 0) {
        setError("데이터를 불러올 수 없습니다");
        setLoading(false);
        return;
      }
      const merged = raw.map(a => ({
        ...a,
        line: DASHBOARD_AGENT_META[a.role]?.line || "공통",
        roleType: DASHBOARD_AGENT_META[a.role]?.role || "-",
        agentColor: DASHBOARD_AGENT_META[a.role]?.color || "#94a3b8",
      }));
      setData(merged);
    } catch (e) {
      setError(`로드 실패: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const enriched = data.length > 0
    ? data.map(a => ({ ...a, ...calcDashboardScore(a) }))
        .sort((a, b) => b.totalScore - a.totalScore)
    : [];

  if (loading && enriched.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"40px 0", color:"#64748b" }}>
        <Spinner/>
        <div style={{ marginTop:10, fontSize:12 }}>학습 데이터 로딩 중...</div>
      </div>
    );
  }

  if (error && enriched.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"30px 0" }}>
        <div style={{ fontSize:24, marginBottom:6 }}>⚠️</div>
        <div style={{ fontSize:12, color:"#ef4444", marginBottom:12 }}>{error}</div>
        <button onClick={fetchData} style={{
          padding:"7px 16px", background:"rgba(59,130,246,0.15)",
          border:"1px solid rgba(59,130,246,0.3)", borderRadius:7,
          color:"#93c5fd", fontSize:11, fontWeight:700, cursor:"pointer",
        }}>🔄 다시 시도</button>
      </div>
    );
  }

  // 통계
  const avgScore = Math.round(enriched.reduce((s, a) => s + a.totalScore, 0) / enriched.length);
  const cellAgents = enriched.filter(a => a.line === "Cell");
  const elecAgents = enriched.filter(a => a.line === "Elec");
  const cellAvg = cellAgents.length > 0
    ? Math.round(cellAgents.reduce((s, a) => s + a.totalScore, 0) / cellAgents.length) : 0;
  const elecAvg = elecAgents.length > 0
    ? Math.round(elecAgents.reduce((s, a) => s + a.totalScore, 0) / elecAgents.length) : 0;
  const totalItems = enriched.reduce((s, a) => s + (a.itemCount || 0), 0);
  const totalCorrections = enriched.reduce((s, a) => s + (a.correctionCount || 0), 0);

  const sel = selected || enriched[0];
  const maxItem = Math.max(...enriched.map(a => a.itemCount || 0), 1);

  return (
    <div style={{ textAlign:"left" }}>
      {/* KPI 5개 */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:6, marginBottom:18 }}>
        <KpiCard label="전체" value={avgScore} suffix="점" color="#a78bfa" />
        <KpiCard label="Cell" value={cellAvg} suffix="점" color={LINE_COLORS.Cell} />
        <KpiCard label="Elec" value={elecAvg} suffix="점" color={LINE_COLORS.Elec} />
        <KpiCard label="학습" value={totalItems} suffix="건" color="#34d399" />
        <KpiCard label="교정" value={totalCorrections} suffix="건" color="#fbbf24" />
      </div>

      {/* 종합 순위 */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:11, color:"#64748b", fontWeight:700, marginBottom:8, letterSpacing:1 }}>
          🏆 종합 순위
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {enriched.map((a, idx) => (
            <RankRow key={a.role} rank={idx+1} agent={a}
              isSelected={sel?.role === a.role}
              onClick={() => setSelected(a)} />
          ))}
        </div>
      </div>

      {/* 선택된 에이전트 상세 */}
      {sel && (
        <div style={{ marginBottom:18 }}>
          <div style={{ fontSize:11, color:"#64748b", fontWeight:700, marginBottom:8, letterSpacing:1 }}>
            🔍 {sel.role} 상세 · {sel.line} · {sel.roleType}
          </div>
          <div style={{
            background:"rgba(15,23,42,0.6)",
            border:`1px solid ${sel.agentColor}25`,
            borderRadius:10, padding:14,
          }}>
            <ProgressBar label={`학습 항목 (${sel.itemCount}건)`} value={sel.itemScore} color={sel.agentColor} />
            <ProgressBar label={`내용 총량 (${sel.contentLength.toLocaleString()}자)`} value={sel.contentScore} color={sel.agentColor} />
            <ProgressBar label={`카테고리 (${sel.categoryCount}종)`} value={sel.categoryScore} color={sel.agentColor} />
            <ProgressBar label={`교정 사례 (${sel.correctionCount}건)`} value={sel.correctionScore} color={sel.agentColor} />
            <ProgressBar label={`최신성 (최근 7일 ${sel.recentRate}%)`} value={sel.freshnessScore} color={sel.agentColor} />

            <div style={{
              marginTop:8, paddingTop:8,
              borderTop:"1px solid rgba(51,65,85,0.4)",
              display:"flex", justifyContent:"space-between", fontSize:10,
            }}>
              <span style={{ color:"#64748b" }}>마지막 업데이트</span>
              <span style={{ color:"#cbd5e1", fontWeight:700 }}>
                {sel.lastUpdate || "데이터 없음"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 학습 항목 비교 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:11, color:"#64748b", fontWeight:700, marginBottom:8, letterSpacing:1 }}>
          📈 학습 항목 수
        </div>
        <div style={{
          background:"rgba(15,23,42,0.5)", border:"1px solid rgba(51,65,85,0.3)",
          borderRadius:10, padding:12,
        }}>
          {enriched.map(a => (
            <div key={a.role} style={{ marginBottom:7 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                <span style={{ fontSize:10.5, color:"#cbd5e1", fontWeight:600 }}>
                  <span style={{ color: a.agentColor, marginRight:5 }}>●</span>{a.role}
                </span>
                <span style={{ fontSize:10.5, color: a.agentColor, fontWeight:700 }}>
                  {a.itemCount}건
                </span>
              </div>
              <div style={{ height:5, background:"rgba(51,65,85,0.5)", borderRadius:3 }}>
                <div style={{
                  height:"100%", borderRadius:3,
                  width:`${(a.itemCount/maxItem)*100}%`,
                  background:`linear-gradient(90deg, ${a.agentColor}, ${a.agentColor}99)`,
                  transition:"width 0.5s ease",
                }}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 지표 설명 */}
      <div style={{
        background:"rgba(8,14,26,0.6)", border:"1px solid rgba(51,65,85,0.3)",
        borderRadius:8, padding:"10px 12px", fontSize:9.5, color:"#64748b",
        lineHeight:1.7,
      }}>
        <div style={{ fontWeight:700, color:"#94a3b8", marginBottom:5 }}>📖 평가 지표 (5개 평균, 절대평가)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>학습 항목</b>: 등록된 row 수 (목표 300건)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>내용 총량</b>: content 글자수 합계 (목표 80,000자)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>카테고리</b>: unique category 개수 (목표 5종)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>교정 사례</b>: 교정사례 카테고리 row 수 (목표 60건)</div>
        <div>• <b style={{ color:"#cbd5e1" }}>최신성</b>: 최근 7일 내 업데이트 비율 (목표 70%)</div>
      </div>
    </div>
  );
}

// 대시보드 - KPI 카드
function KpiCard({ label, value, suffix, color }) {
  return (
    <div style={{
      background:"rgba(15,23,42,0.7)",
      border:"1px solid rgba(51,65,85,0.4)",
      borderLeft:`3px solid ${color}`,
      borderRadius:7, padding:"8px 10px",
    }}>
      <div style={{ fontSize:9, color:"#64748b", fontWeight:700, marginBottom:2,
        letterSpacing:1, textTransform:"uppercase" }}>{label}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:3 }}>
        <span style={{ fontSize:18, fontWeight:800, color:"#f1f5f9" }}>{value}</span>
        <span style={{ fontSize:10, color:"#475569" }}>{suffix}</span>
      </div>
    </div>
  );
}

// 대시보드 - 순위 행
function RankRow({ rank, agent, isSelected, onClick }) {
  return (
    <div onClick={onClick} style={{
      display:"grid",
      gridTemplateColumns:"24px 1fr auto auto",
      gap:10, alignItems:"center", padding:"8px 10px",
      background: isSelected ? "rgba(51,65,85,0.5)" : "rgba(8,14,26,0.6)",
      border: `1px solid ${isSelected ? agent.agentColor : "rgba(51,65,85,0.35)"}`,
      borderRadius:7, cursor:"pointer", transition:"all 0.15s",
    }}>
      <div style={{
        width:22, height:22, borderRadius:11,
        background: rank <= 3 ? "#fbbf24" : "rgba(71,85,105,0.6)",
        color: rank <= 3 ? "#1e293b" : "#cbd5e1",
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:11, fontWeight:800,
      }}>{rank}</div>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:"#f1f5f9" }}>{agent.role}</div>
        <div style={{ fontSize:9.5, color:"#64748b" }}>
          <span style={{ color: agent.agentColor }}>●</span> {agent.line} · {agent.roleType}
        </div>
      </div>
      <div style={{
        fontSize:9, padding:"2px 7px", borderRadius:9,
        background: SCORE_COLOR(agent.totalScore) + "25",
        color: SCORE_COLOR(agent.totalScore), fontWeight:700,
      }}>{SCORE_LABEL(agent.totalScore)}</div>
      <div style={{
        fontSize:16, fontWeight:800, color:"#f1f5f9",
        minWidth:32, textAlign:"right",
      }}>{agent.totalScore}</div>
    </div>
  );
}

// ─── 메인 앱 ─────────────────────────────────────────────────────────────────
const TABS = [
  { id:0, icon:"💬", label:"채팅 학습" },
  { id:1, icon:"📋", label:"업무 규칙" },
  { id:2, icon:"🎯", label:"상황 교정" },
  { id:3, icon:"📄", label:"문서·사진" },
  { id:4, icon:"🧠", label:"학습 현황" },
];

export default function App() {
  const role = getRole();
  const roleInfo = role ? ROLE_CONFIG[role] : null;
  const [tab, setTab] = useState(0);
  const [knowledge, setKnowledge] = useState([]);
  const [loadingKB, setLoadingKB] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  // ─── 학습자료 폴더 동기화 (Step 5-C) ───
  const [folderScan, setFolderScan] = useState({ roleFiles: [], commonFiles: [] });
  const [scanning, setScanning] = useState(false);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncingFiles, setSyncingFiles] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, currentFile: "" });
  const [syncResult, setSyncResult] = useState(null);
  const [showPdfModeDialog, setShowPdfModeDialog] = useState(false); // PDF 모드 선택 모달
  const [syncPdfMode, setSyncPdfMode] = useState("auto"); // "auto" | "vision"

  const loadKB = async () => {
    if (!role) return;
    setLoadingKB(true);
    try {
      const data = await loadFromSheet(role);
      setKnowledge(data);
    } catch {}
    finally { setLoadingKB(false); }
  };

  // 학습자료 폴더 스캔 (학습 화면 진입 시 자동)
  const doFolderScan = async () => {
    if (!role) return;
    setScanning(true);
    try {
      const result = await scanLearningFolder(role);
      setFolderScan(result);
    } catch {}
    finally { setScanning(false); }
  };

  useEffect(() => { loadKB(); }, [role]);
  useEffect(() => { doFolderScan(); }, [role]);

  // 새 파일 일괄 학습
  // PDF가 포함되어 있으면 먼저 모달로 처리 방식 선택받은 후 진행
  const requestSync = () => {
    const allFiles = [
      ...folderScan.roleFiles,
      ...folderScan.commonFiles,
    ];
    const hasPdf = allFiles.some(f => (f.mimetype || "").includes("pdf") || (f.filename || "").toLowerCase().endsWith(".pdf"));
    if (hasPdf) {
      // PDF가 있으면 처리 방식 선택 모달
      setShowPdfModeDialog(true);
    } else {
      // 이미지만 있으면 바로 진행
      startSync();
    }
  };

  const startSync = async () => {
    setShowPdfModeDialog(false);
    setSyncingFiles(true);
    setSyncResult(null);
    const allFiles = [
      ...folderScan.roleFiles.map(f => ({ ...f, source: "role" })),
      ...folderScan.commonFiles.map(f => ({ ...f, source: "common" })),
    ];
    setSyncProgress({ current: 0, total: allFiles.length, currentFile: "" });

    let successCount = 0;
    let failCount = 0;
    let pdfTextCount = 0;
    let pdfVisionCount = 0;
    const errors = [];

    for (let i = 0; i < allFiles.length; i++) {
      const f = allFiles[i];
      // 진행 표시: 폴더 경로 + 파일명
      const displayName = f.subPath ? `${f.subPath}/${f.filename}` : f.filename;
      setSyncProgress({ current: i + 1, total: allFiles.length, currentFile: displayName });

      try {
        // 1. 파일 다운로드
        const fetchResult = await fetchDriveFile(f.fileId);
        if (!fetchResult.success) {
          failCount++;
          errors.push(`${displayName}: ${fetchResult.error}`);
          console.error(`[Sync] 다운로드 실패: ${displayName}`, fetchResult.error);
          continue;
        }
        const fileData = fetchResult.data;

        const isImageFile = (fileData.mimetype || "").startsWith("image/");
        const isPdfFile = (fileData.mimetype || "").includes("pdf") || (f.filename || "").toLowerCase().endsWith(".pdf");

        if (isImageFile) {
          // ─── 이미지 처리 (기존 로직) ───
          const folderHint = f.subPath ? `\n폴더 경로: ${f.subPath} (분류 힌트로 활용)` : "";
          const sys = `당신은 ${roleInfo.label}(${role}) AI입니다.
이 이미지에서 ${role} 업무 관련 핵심 내용을 추출하세요.${folderHint}
다음 형식으로 한국어 답변 (300자 이내):
[추출 텍스트] (이미지에서 읽은 정보)
[시각 설명] (시각적 특징 한 줄)
[추천 카테고리] 공장정보|업무역할|판단기준|협업방식|교정사례 중 하나`;

          const analyzed = await callClaudeVision(sys, "이 이미지를 분석하세요.", fileData.base64, fileData.mimetype);
          const catMatch = analyzed.match(/\[추천 카테고리\]\s*([가-힣]+)/);
          const recommendedCat = catMatch ? catMatch[1] : "판단기준";
          const sourceTag = f.subPath ? `[자동학습-${f.subPath}/${f.filename}]` : `[자동학습-${f.filename}]`;
          const content = `${sourceTag} [이미지URL] ${f.url}\n${analyzed}`;
          if (f.source === "common") {
            await saveCommonKnowledge(recommendedCat, content);
          } else {
            await saveToSheet(role, recommendedCat, content);
          }
          await markFileProcessed(f.source === "common" ? "_COMMON_" : role, f.fileId, f.filename);
          successCount++;
        } else if (isPdfFile) {
          // ─── PDF 처리 (학습앱 직접 업로드와 동일 로직) ───
          // base64 → Blob → File로 변환해서 pdf.js에 전달
          const byteChars = atob(fileData.base64);
          const byteNumbers = new Array(byteChars.length);
          for (let j = 0; j < byteChars.length; j++) {
            byteNumbers[j] = byteChars.charCodeAt(j);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: "application/pdf" });
          const fileObj = new File([blob], f.filename, { type: "application/pdf" });

          const pdf = await loadPdfDocument(fileObj);
          const pageCount = pdf.numPages;

          let pdfResult = "";
          let usedMode = "";

          // 텍스트 추출 우선 모드면 먼저 시도
          if (syncPdfMode === "auto") {
            setSyncProgress({ current: i + 1, total: allFiles.length, currentFile: `${displayName} (텍스트 추출 시도...)` });
            const fullText = await extractPdfText(pdf);

            if (fullText && fullText.trim().length >= 50) {
              // 텍스트 추출 성공
              const folderHint = f.subPath ? `\n폴더 경로: ${f.subPath} (분류 힌트)` : "";
              const sys = `${roleInfo.label}(${role}) AI입니다. PDF에서 추출한 텍스트입니다.${folderHint}
한국어로 핵심 내용만 간결하게 정리. 500자 이내.
표/구조가 있으면 살려서 정리하세요.
마지막 줄에 [추천 카테고리] 공장정보|업무역할|판단기준|협업방식|교정사례 중 하나로 분류.`;
              const truncated = fullText.slice(0, 12000);
              pdfResult = await callClaude(sys, `다음 PDF 내용에서 핵심을 추출하세요:\n\n${truncated}`);
              pdfResult = `[PDF: ${f.filename} - 텍스트 추출, ${pageCount}페이지]\n${pdfResult}`;
              usedMode = "text";
              pdfTextCount++;
            } else {
              // 텍스트 부족 → 그림 분석으로 폴백
              usedMode = "vision_fallback";
            }
          }

          // 그림 분석 모드 (또는 폴백)
          if (syncPdfMode === "vision" || usedMode === "vision_fallback") {
            const allResults = [];
            const pageUrls = [];

            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
              setSyncProgress({
                current: i + 1, total: allFiles.length,
                currentFile: `${displayName} (페이지 ${pageNum}/${pageCount} 분석 중...)`,
              });

              const pageBase64 = await pdfPageToBase64(pdf, pageNum);
              const pageFilename = `${f.filename.replace(/\.pdf$/i, "")}_p${pageNum}.jpg`;

              // 드라이브 업로드
              let pageUrl = "";
              try {
                const uploadResult = await uploadImageToDrive(role, pageFilename, pageBase64, "image/jpeg");
                if (uploadResult && uploadResult.url) pageUrl = uploadResult.url;
              } catch (e) { /* 업로드 실패해도 분석은 계속 */ }
              pageUrls.push(pageUrl);

              // Vision 분석
              const folderHint = f.subPath ? `\n폴더 경로: ${f.subPath}` : "";
              const pagePrompt = `${roleInfo.label}(${role}) AI입니다. PDF 페이지 ${pageNum}/${pageCount} 분석.${folderHint}
다음 형식으로 한국어 답변 (200자 이내):
[추출 텍스트] (페이지 핵심 내용)
[시각 설명] (레이아웃, 표, 다이어그램 등 시각 요소)`;

              try {
                const pageRes = await callClaudeVision(pagePrompt, "이 PDF 페이지를 분석하세요.", pageBase64, "image/jpeg");
                allResults.push(`━━ 페이지 ${pageNum} ━━\n${pageRes}`);
              } catch (e) {
                allResults.push(`━━ 페이지 ${pageNum} ━━\n(분석 실패)`);
              }
            }

            // 종합 요약
            setSyncProgress({
              current: i + 1, total: allFiles.length,
              currentFile: `${displayName} (종합 분석 중...)`,
            });
            const combined = allResults.join("\n\n");
            const sumSys = `위 페이지별 분석 결과들을 종합해서 PDF 전체의 핵심을 ${roleInfo.label}(${role}) 관점에서 한국어 500자 이내로 정리하세요.
마지막 줄에 [추천 카테고리] 공장정보|업무역할|판단기준|협업방식|교정사례 중 하나로 분류.`;
            const summary = await callClaude(sumSys, combined);

            const urlLines = pageUrls
              .map((u, idx) => u ? `[페이지${idx+1}URL] ${u}` : `[페이지${idx+1}URL] (업로드 실패)`)
              .join("\n");

            const fallbackTag = usedMode === "vision_fallback" ? " (텍스트 부족으로 자동 전환)" : "";
            pdfResult = `[PDF: ${f.filename} - 그림 분석${fallbackTag}, ${pageCount}페이지]\n${urlLines}\n\n[종합 요약]\n${summary}\n\n[페이지별 상세]\n${combined}`;
            pdfVisionCount++;
          }

          // 카테고리 추출
          const catMatch = pdfResult.match(/\[추천 카테고리\]\s*([가-힣]+)/);
          const recommendedCat = catMatch ? catMatch[1] : "판단기준";
          const sourceTag = f.subPath ? `[자동학습-${f.subPath}/${f.filename}]` : `[자동학습-${f.filename}]`;
          const content = `${sourceTag}\n${pdfResult}`;

          if (f.source === "common") {
            await saveCommonKnowledge(recommendedCat, content);
          } else {
            await saveToSheet(role, recommendedCat, content);
          }
          await markFileProcessed(f.source === "common" ? "_COMMON_" : role, f.fileId, f.filename);
          successCount++;
        } else {
          // 그 외 파일 (Word/Excel 등) - 미지원
          failCount++;
          errors.push(`${displayName}: 미지원 파일 형식 (${fileData.mimetype}) - PDF로 변환 권장`);
          await markFileProcessed(f.source === "common" ? "_COMMON_" : role, f.fileId, f.filename);
          continue;
        }
      } catch (e) {
        failCount++;
        errors.push(`${displayName}: ${e.message}`);
      }
    }

    setSyncResult({ successCount, failCount, errors, pdfTextCount, pdfVisionCount });
    setSyncingFiles(false);
    await doFolderScan();
    await loadKB();
  };

  // role 없을 때 - 에이전트 선택 화면
  if (!role) {
    return (
      <div style={{
        minHeight:"100vh",
        background:"linear-gradient(150deg,#03060d,#060d1c 55%,#040810)",
        fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
        padding:"40px 16px",
      }}>
        <div style={{ maxWidth:660, margin:"0 auto" }}>
          {/* 헤더 */}
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontSize:40, marginBottom:14 }}>🏭</div>
            <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>
              Factory Engineer AI 학습
            </div>
            <div style={{ fontSize:13, color:"#64748b" }}>
              역할을 선택해서 접속하세요
            </div>
          </div>

          {/* 에이전트 선택 카드 */}
          {["Cell","Elec","공통"].map(line => (
            <div key={line} style={{ marginBottom:24 }}>
              <div style={{ fontSize:12, color:"#64748b", fontWeight:800,
                letterSpacing:2, marginBottom:12, textAlign:"center" }}>
                {line === "공통" ? "공통" : `${line} 라인`}
              </div>
              <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
                {Object.entries(ROLE_CONFIG)
                  .filter(([_, info]) => info.line === line)
                  .map(([r, info]) => (
                    <a key={r} href={`?role=${r}`} onClick={(e)=>{e.preventDefault();window.location.href=`?role=${r}`;}} style={{
                      display:"block", padding:"14px 18px",
                      background:info.bg, border:`1.5px solid ${info.color}40`,
                      borderRadius:12, color:info.color,
                      fontSize:13, fontWeight:800, textDecoration:"none",
                      transition:"all 0.2s", textAlign:"center",
                    }}>
                      <div style={{ fontSize:24, marginBottom:5 }}>{info.icon}</div>
                      <div>{r}</div>
                      <div style={{ fontSize:10, color:"#475569", marginTop:2 }}>{info.label}</div>
                    </a>
                  ))
                }
              </div>
            </div>
          ))}

          {/* 학습 현황 보기 토글 */}
          <div style={{ marginTop:32, marginBottom:8 }}>
            <button onClick={() => setShowDashboard(s => !s)} style={{
              width:"100%", padding:"14px 20px",
              background: showDashboard ? "rgba(167,139,250,0.12)" : "rgba(15,23,42,0.7)",
              border: `1.5px solid ${showDashboard ? "rgba(167,139,250,0.4)" : "rgba(51,65,85,0.5)"}`,
              borderRadius:12,
              color: showDashboard ? "#a78bfa" : "#94a3b8",
              fontSize:13, fontWeight:800, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"space-between",
              transition:"all 0.2s",
            }}>
              <span>📊 전체 학습 현황 보기</span>
              <span style={{
                fontSize:14,
                transform: showDashboard ? "rotate(180deg)" : "rotate(0deg)",
                transition:"transform 0.3s",
              }}>▼</span>
            </button>
          </div>

          {/* 토글 펼침 영역 */}
          {showDashboard && (
            <div style={{
              marginTop:14,
              padding:"18px 16px",
              background:"rgba(8,14,26,0.6)",
              border:"1px solid rgba(51,65,85,0.4)",
              borderRadius:12,
              animation:"fadeUp 0.3s ease both",
            }}>
              <HomeDashboard/>
            </div>
          )}
        </div>

        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
          *{box-sizing:border-box}
          button:hover:not(:disabled){filter:brightness(1.1)}
          a:hover{filter:brightness(1.1)}
          ::-webkit-scrollbar{width:3px}
          ::-webkit-scrollbar-thumb{background:rgba(59,130,246,0.2);border-radius:2px}
        `}</style>
      </div>
    );
  }

  const panels = [
    <TabChat role={role} roleInfo={roleInfo}/>,
    <TabRules role={role} roleInfo={roleInfo}/>,
    <TabCorrection role={role} roleInfo={roleInfo} knowledge={knowledge}/>,
    <TabDocument role={role} roleInfo={roleInfo}/>,
    <TabStatus role={role} roleInfo={roleInfo} knowledge={knowledge} onReload={loadKB} loading={loadingKB}/>,
  ];

  return (
    <div style={{
      minHeight:"100vh",
      background:"linear-gradient(150deg,#03060d,#060d1c 55%,#040810)",
      fontFamily:"'Noto Sans KR','Malgun Gothic',sans-serif",
      color:"#e2e8f0",
    }}>
      {/* Header */}
      <div style={{
        background:"rgba(3,6,13,0.96)", backdropFilter:"blur(12px)",
        borderBottom:`1px solid ${roleInfo.color}20`,
        padding:"12px 20px", position:"sticky", top:0, zIndex:100,
        display:"flex", alignItems:"center", gap:12,
      }}>
        <div style={{
          width:34, height:34, borderRadius:8,
          background:roleInfo.bg, border:`1.5px solid ${roleInfo.color}44`,
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
        }}>{roleInfo.icon}</div>
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:"#f1f5f9" }}>
            {roleInfo.label} AI 학습
          </div>
          <div style={{ fontSize:9, color:roleInfo.color, letterSpacing:2, fontWeight:700 }}>
            {role} ENGINEER · TRAINING MODE
          </div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={() => { window.location.href = window.location.pathname; }} style={{
            background:"rgba(51,65,85,0.4)", border:"1px solid rgba(71,85,105,0.5)",
            color:"#94a3b8", borderRadius:6, padding:"5px 11px",
            fontSize:11, fontWeight:700, cursor:"pointer",
            display:"inline-flex", alignItems:"center", gap:4,
          }} title="에이전트 선택 화면으로">
            🏠 홈
          </button>
          <span style={{
            background:roleInfo.bg, border:`1px solid ${roleInfo.color}40`,
            color:roleInfo.color, borderRadius:6, padding:"3px 10px",
            fontSize:11, fontWeight:800,
          }}>{role}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display:"flex", borderBottom:"1px solid rgba(51,65,85,0.3)",
        background:"rgba(3,6,13,0.85)", overflowX:"auto",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:"1 0 auto", padding:"11px 6px",
            background:tab===t.id?`${roleInfo.color}0d`:"transparent",
            border:"none",
            borderBottom:`2px solid ${tab===t.id?roleInfo.color:"transparent"}`,
            color:tab===t.id?roleInfo.color:"#374151",
            fontSize:10, fontWeight:800, cursor:"pointer",
            display:"flex", flexDirection:"column", alignItems:"center", gap:2,
          }}>
            <span style={{ fontSize:16 }}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div style={{ maxWidth:660, margin:"0 auto", padding:"22px 16px 60px" }}>
        {/* 학습자료 폴더 동기화 알림 카드 */}
        {(folderScan.roleFiles.length > 0 || folderScan.commonFiles.length > 0) && (
          <div style={{
            background:`${roleInfo.color}08`,
            border:`1.5px solid ${roleInfo.color}40`,
            borderRadius:12, padding:"12px 16px", marginBottom:16,
            display:"flex", alignItems:"center", gap:12,
          }}>
            <div style={{ fontSize:24 }}>📁</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700, color:roleInfo.color }}>
                새 학습자료 {folderScan.roleFiles.length + folderScan.commonFiles.length}개 발견
              </div>
              <div style={{ fontSize:10.5, color:"#64748b", marginTop:2 }}>
                {folderScan.roleFiles.length > 0 && `${role}: ${folderScan.roleFiles.length}개`}
                {folderScan.roleFiles.length > 0 && folderScan.commonFiles.length > 0 && " · "}
                {folderScan.commonFiles.length > 0 && `공통: ${folderScan.commonFiles.length}개`}
              </div>
            </div>
            <button onClick={() => setShowSyncDialog(true)} style={{
              padding:"7px 14px",
              background:`${roleInfo.color}25`,
              border:`1px solid ${roleInfo.color}60`,
              borderRadius:7, color:roleInfo.color,
              fontSize:11, fontWeight:700, cursor:"pointer",
              whiteSpace:"nowrap",
            }}>
              📥 학습 시작
            </button>
          </div>
        )}

        {panels[tab]}
      </div>

      {/* 학습자료 동기화 모달 */}
      {showSyncDialog && (
        <div style={{
          position:"fixed", top:0, left:0, right:0, bottom:0,
          background:"rgba(0,0,0,0.7)", backdropFilter:"blur(4px)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000, padding:"16px",
        }}>
          <div style={{
            background:"#0f172a", border:`1.5px solid ${roleInfo.color}40`,
            borderRadius:14, padding:"20px", maxWidth:540, width:"100%",
            maxHeight:"90vh", overflowY:"auto",
          }}>
            {!syncingFiles && !syncResult && (
              <>
                <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>
                  📁 학습자료 일괄 학습
                </div>
                <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:16, lineHeight:1.6 }}>
                  드라이브 학습자료 폴더에서 발견된 새 파일을 일괄 학습합니다.
                  <br/>
                  현재 <strong style={{ color:"#fbbf24" }}>이미지 파일만</strong> 자동 학습 지원됩니다.
                  <br/>
                  <span style={{ color:"#64748b", fontSize:10.5 }}>
                    (PDF는 옵션 선택이 필요하므로 학습앱에서 직접 업로드, Word/Excel은 PDF 변환 후 업로드 권장)
                  </span>
                </div>

                {/* role 폴더 파일 */}
                {folderScan.roleFiles.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:roleInfo.color, fontWeight:700, marginBottom:6 }}>
                      📂 {role} 폴더 ({folderScan.roleFiles.length}개)
                    </div>
                    {folderScan.roleFiles.map((f, i) => (
                      <div key={i} style={{
                        background:"rgba(15,23,42,0.6)",
                        border:"1px solid rgba(51,65,85,0.4)",
                        borderRadius:6, padding:"6px 10px", marginBottom:4,
                        fontSize:11, color:"#cbd5e1",
                      }}>
                        {f.subPath && (
                          <span style={{
                            fontSize:9.5, color:roleInfo.color,
                            background:`${roleInfo.color}15`,
                            padding:"1px 6px", borderRadius:3, marginRight:6,
                            fontWeight:700,
                          }}>📁 {f.subPath}</span>
                        )}
                        {f.filename}
                        <span style={{ fontSize:9.5, color:"#64748b", marginLeft:6 }}>
                          ({(f.size/1024).toFixed(0)}KB · {f.mimetype})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 공통 폴더 파일 */}
                {folderScan.commonFiles.length > 0 && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:"#34d399", fontWeight:700, marginBottom:6 }}>
                      🌐 공통 폴더 ({folderScan.commonFiles.length}개)
                    </div>
                    <div style={{ fontSize:10, color:"#64748b", marginBottom:6 }}>
                      모든 에이전트가 참조하는 공통 학습 데이터로 저장됩니다
                    </div>
                    {folderScan.commonFiles.map((f, i) => (
                      <div key={i} style={{
                        background:"rgba(15,23,42,0.6)",
                        border:"1px solid rgba(52,211,153,0.25)",
                        borderRadius:6, padding:"6px 10px", marginBottom:4,
                        fontSize:11, color:"#cbd5e1",
                      }}>
                        {f.subPath && (
                          <span style={{
                            fontSize:9.5, color:"#34d399",
                            background:"rgba(52,211,153,0.15)",
                            padding:"1px 6px", borderRadius:3, marginRight:6,
                            fontWeight:700,
                          }}>📁 {f.subPath}</span>
                        )}
                        {f.filename}
                        <span style={{ fontSize:9.5, color:"#64748b", marginLeft:6 }}>
                          ({(f.size/1024).toFixed(0)}KB · {f.mimetype})
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={requestSync} style={{
                    flex:1, padding:"10px",
                    background:`linear-gradient(135deg,${roleInfo.color},${roleInfo.color}cc)`,
                    border:"none", borderRadius:8, color:"#fff",
                    fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>
                    📥 일괄 학습 시작
                  </button>
                  <button onClick={() => setShowSyncDialog(false)} style={{
                    padding:"10px 16px",
                    background:"rgba(51,65,85,0.4)",
                    border:"1px solid rgba(71,85,105,0.5)",
                    borderRadius:8, color:"#94a3b8",
                    fontSize:13, fontWeight:700, cursor:"pointer",
                  }}>
                    취소
                  </button>
                </div>
              </>
            )}

            {syncingFiles && (
              <>
                <div style={{ fontSize:16, fontWeight:800, color:"#f1f5f9", marginBottom:12 }}>
                  📥 학습 중...
                </div>
                <div style={{ fontSize:11, color:"#94a3b8", marginBottom:8 }}>
                  {syncProgress.current}/{syncProgress.total} · {syncProgress.currentFile}
                </div>
                <div style={{ height:6, background:"rgba(51,65,85,0.5)", borderRadius:3, overflow:"hidden" }}>
                  <div style={{
                    height:"100%",
                    width: syncProgress.total > 0 ? `${(syncProgress.current/syncProgress.total)*100}%` : "0%",
                    background:`linear-gradient(90deg,${roleInfo.color},${roleInfo.color}99)`,
                    transition:"width 0.3s",
                  }}/>
                </div>
                <div style={{ fontSize:10, color:"#64748b", marginTop:14, textAlign:"center" }}>
                  파일 분석 중입니다. 잠시만 기다려주세요...
                </div>
              </>
            )}

            {syncResult && (
              <>
                <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:12 }}>
                  ✅ 학습 완료
                </div>
                <div style={{
                  background:"rgba(15,23,42,0.6)", border:"1px solid rgba(51,65,85,0.4)",
                  borderRadius:8, padding:"12px 14px", marginBottom:12,
                }}>
                  <div style={{ fontSize:12, color:"#34d399", fontWeight:700, marginBottom:4 }}>
                    성공: {syncResult.successCount}개
                  </div>
                  {(syncResult.pdfTextCount > 0 || syncResult.pdfVisionCount > 0) && (
                    <div style={{ fontSize:10, color:"#94a3b8", marginTop:4, marginBottom:4 }}>
                      {syncResult.pdfTextCount > 0 && `📝 PDF 텍스트 추출: ${syncResult.pdfTextCount}개  `}
                      {syncResult.pdfVisionCount > 0 && `🖼️ PDF 그림 분석: ${syncResult.pdfVisionCount}개`}
                    </div>
                  )}
                  {syncResult.failCount > 0 && (
                    <div style={{ fontSize:12, color:"#f87171", fontWeight:700 }}>
                      실패: {syncResult.failCount}개
                    </div>
                  )}
                </div>

                {syncResult.errors.length > 0 && (
                  <div style={{
                    background:"rgba(239,68,68,0.05)", border:"1px solid rgba(239,68,68,0.2)",
                    borderRadius:8, padding:"10px 12px", marginBottom:12,
                    maxHeight:160, overflowY:"auto",
                  }}>
                    <div style={{ fontSize:10, color:"#f87171", fontWeight:700, marginBottom:6 }}>
                      실패 상세
                    </div>
                    {syncResult.errors.map((err, i) => (
                      <div key={i} style={{ fontSize:10, color:"#fca5a5", marginBottom:3 }}>
                        • {err}
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => {
                  setShowSyncDialog(false);
                  setSyncResult(null);
                }} style={{
                  width:"100%", padding:"10px",
                  background:`linear-gradient(135deg,${roleInfo.color},${roleInfo.color}cc)`,
                  border:"none", borderRadius:8, color:"#fff",
                  fontSize:13, fontWeight:700, cursor:"pointer",
                }}>
                  확인
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* PDF 처리 방식 선택 모달 (Step 5-C 보강) */}
      {showPdfModeDialog && (() => {
        // PDF 파일 통계 계산
        const allFiles = [...folderScan.roleFiles, ...folderScan.commonFiles];
        const pdfFiles = allFiles.filter(f =>
          (f.mimetype || "").includes("pdf") || (f.filename || "").toLowerCase().endsWith(".pdf")
        );
        const pdfCount = pdfFiles.length;

        return (
          <div style={{
            position:"fixed", top:0, left:0, right:0, bottom:0,
            background:"rgba(0,0,0,0.75)", backdropFilter:"blur(4px)",
            display:"flex", alignItems:"center", justifyContent:"center",
            zIndex:1100, padding:"16px",
          }}>
            <div style={{
              background:"#0f172a", border:`1.5px solid ${roleInfo.color}40`,
              borderRadius:14, padding:"20px", maxWidth:520, width:"100%",
            }}>
              <div style={{ fontSize:18, fontWeight:800, color:"#f1f5f9", marginBottom:6 }}>
                📄 PDF 처리 방식 선택
              </div>
              <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:14, lineHeight:1.6 }}>
                발견된 PDF {pdfCount}개의 처리 방식을 선택하세요.
                <br/>
                <span style={{ color:"#64748b", fontSize:10.5 }}>
                  (이미지 파일은 이 설정과 무관하게 정상 처리됩니다)
                </span>
              </div>

              {/* 텍스트 추출 우선 */}
              <div onClick={() => setSyncPdfMode("auto")} style={{
                padding:"12px 14px", cursor:"pointer", marginBottom:8,
                background: syncPdfMode === "auto" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
                border: `1.5px solid ${syncPdfMode === "auto" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
                borderRadius:8,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <div style={{
                    width:14, height:14, borderRadius:"50%",
                    border:`2px solid ${syncPdfMode === "auto" ? roleInfo.color : "#475569"}`,
                    background: syncPdfMode === "auto" ? roleInfo.color : "transparent",
                  }}/>
                  <span style={{ fontSize:13, fontWeight:700,
                    color: syncPdfMode === "auto" ? roleInfo.color : "#cbd5e1" }}>
                    📝 텍스트 추출 우선 (자동 폴백) ⭐
                  </span>
                </div>
                <div style={{ fontSize:10.5, color:"#94a3b8", lineHeight:1.6, paddingLeft:20 }}>
                  • 텍스트 PDF: 빠르고 저렴하게 처리 (페이지당 약 $0.0005)
                  <br/>
                  • 스캔 PDF: 자동으로 그림 분석으로 전환 (페이지당 $0.02)
                  <br/>
                  <span style={{ color:"#34d399" }}>✓ 작업 표준서, 규정, 매뉴얼에 적합</span>
                </div>
              </div>

              {/* 모두 그림 분석 */}
              <div onClick={() => setSyncPdfMode("vision")} style={{
                padding:"12px 14px", cursor:"pointer", marginBottom:14,
                background: syncPdfMode === "vision" ? `${roleInfo.color}15` : "rgba(8,14,26,0.7)",
                border: `1.5px solid ${syncPdfMode === "vision" ? roleInfo.color : "rgba(51,65,85,0.5)"}`,
                borderRadius:8,
              }}>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
                  <div style={{
                    width:14, height:14, borderRadius:"50%",
                    border:`2px solid ${syncPdfMode === "vision" ? roleInfo.color : "#475569"}`,
                    background: syncPdfMode === "vision" ? roleInfo.color : "transparent",
                  }}/>
                  <span style={{ fontSize:13, fontWeight:700,
                    color: syncPdfMode === "vision" ? roleInfo.color : "#cbd5e1" }}>
                    🖼️ 모두 그림 분석
                  </span>
                </div>
                <div style={{ fontSize:10.5, color:"#94a3b8", lineHeight:1.6, paddingLeft:20 }}>
                  • 모든 PDF의 모든 페이지를 Vision API로 분석 (페이지당 $0.02)
                  <br/>
                  • 페이지별 이미지를 드라이브에 자동 저장
                  <br/>
                  <span style={{ color:"#34d399" }}>✓ 시각 정보 중요한 자료(검사기준서, 도면, 다이어그램)에 적합</span>
                  <br/>
                  <span style={{ color:"#fbbf24" }}>⚠️ 비용 ↑, 처리 시간 ↑</span>
                </div>
              </div>

              <div style={{ display:"flex", gap:8 }}>
                <button onClick={startSync} style={{
                  flex:1, padding:"10px",
                  background:`linear-gradient(135deg,${roleInfo.color},${roleInfo.color}cc)`,
                  border:"none", borderRadius:8, color:"#fff",
                  fontSize:13, fontWeight:700, cursor:"pointer",
                }}>
                  📥 학습 시작
                </button>
                <button onClick={() => setShowPdfModeDialog(false)} style={{
                  padding:"10px 16px",
                  background:"rgba(51,65,85,0.4)",
                  border:"1px solid rgba(71,85,105,0.5)",
                  borderRadius:8, color:"#94a3b8",
                  fontSize:13, fontWeight:700, cursor:"pointer",
                }}>
                  취소
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        *{box-sizing:border-box}
        textarea:focus,input:focus{border-color:rgba(59,130,246,0.5)!important}
        button:hover:not(:disabled){filter:brightness(1.1)}
        a:hover{filter:brightness(1.1)}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:rgba(59,130,246,0.2);border-radius:2px}
      `}</style>
    </div>
  );
}
