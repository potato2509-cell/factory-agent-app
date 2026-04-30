// netlify/functions/claude-result.js
// ─── 영역 12-AQ: Background 결과 조회 endpoint ──────────────────────────────────
// GET /.netlify/functions/claude-result?jobId=xxx
// 응답: { status: "pending"|"done"|"failed", text?, error?, elapsedMs? }

import { getStore } from "@netlify/blobs";

export const handler = async (event) => {
  // CORS / GET only
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const jobId = event.queryStringParameters?.jobId || "";
  if (!jobId || jobId.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobId required" }) };
  }

  try {
    const store = getStore("claude-jobs");
    const result = await store.get(jobId, { type: "json" });

    if (!result) {
      return {
        statusCode: 404,
        body: JSON.stringify({ status: "not_found", jobId }),
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `blobs read failed: ${e?.message || String(e)}` }),
    };
  }
};
