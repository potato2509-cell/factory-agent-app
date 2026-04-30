// netlify/functions/claude-result.js
// ─── 영역 12-AQ + 12-AR: Background 결과 조회 endpoint ──────────────────────────
// GET /.netlify/functions/claude-result?jobId=xxx
// 응답: { status: "pending"|"done"|"failed", text?, error?, elapsedMs? }
// ★ 12-AR: 새 함수 포맷 (Web API Request/Response) — Blobs context 자동 주입

import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // URL 파싱으로 jobId 쿼리 파라미터 추출
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId") || "";

  if (!jobId || jobId.length < 8) {
    return new Response(JSON.stringify({ error: "jobId required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const store = getStore("claude-jobs");
    const result = await store.get(jobId, { type: "json" });

    if (!result) {
      return new Response(JSON.stringify({ status: "not_found", jobId }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `blobs read failed: ${e?.message || String(e)}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
