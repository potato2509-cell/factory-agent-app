// netlify/functions/claude-bg-background.js
// ─── 영역 12-AQ: Background Function (Pro 플랜, timeout 15분) ──────────────────
// 호출 즉시 202 반환, Anthropic API 호출 후 결과를 Netlify Blobs에 저장
// 파일명에 `-background` 접미사 → 자동으로 background mode (Netlify 규약)

import { getStore } from "@netlify/blobs";

export const handler = async (event) => {
  // 1. POST 요청 검증
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { jobId, system, userMsg, max_tokens = 3500, model = "claude-sonnet-4-5" } = payload;

  if (!jobId || typeof jobId !== "string" || jobId.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobId required (min 8 chars)" }) };
  }
  if (!system || !userMsg) {
    return { statusCode: 400, body: JSON.stringify({ error: "system and userMsg required" }) };
  }

  // 2. Blobs store 연결 + pending 마크
  const store = getStore("claude-jobs");
  const t0 = Date.now();

  try {
    await store.setJSON(jobId, {
      status: "pending",
      startedAt: new Date().toISOString(),
      model,
      max_tokens,
    });
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "blobs store init failed: " + e.message }) };
  }

  // 3. Background에서 Anthropic API 호출 (15분 timeout 가능)
  // 클라이언트는 이미 202를 받고 분리됨 — 아래 처리는 백그라운드에서 진행
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await store.setJSON(jobId, {
        status: "failed",
        error: "ANTHROPIC_API_KEY not configured",
        elapsedMs: Date.now() - t0,
      });
      return { statusCode: 202, body: JSON.stringify({ ok: true, jobId, msg: "background started (config error)" }) };
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      await store.setJSON(jobId, {
        status: "failed",
        error: `Anthropic HTTP ${res.status}: ${errText.slice(0, 300)}`,
        elapsedMs: Date.now() - t0,
      });
      return { statusCode: 202, body: JSON.stringify({ ok: true, jobId }) };
    }

    const data = await res.json();
    const text = (data.content || []).map(c => c.text || "").join("").trim();

    await store.setJSON(jobId, {
      status: "done",
      text,
      elapsedMs: Date.now() - t0,
      finishedAt: new Date().toISOString(),
      model,
      usage: data.usage || null,
    });

    return { statusCode: 202, body: JSON.stringify({ ok: true, jobId, msg: "completed" }) };

  } catch (e) {
    await store.setJSON(jobId, {
      status: "failed",
      error: `exception: ${e?.message || String(e)}`.slice(0, 500),
      elapsedMs: Date.now() - t0,
    });
    return { statusCode: 202, body: JSON.stringify({ ok: true, jobId, msg: "background failed" }) };
  }
};
