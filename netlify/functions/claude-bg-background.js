// netlify/functions/claude-bg-background.js
// ─── 영역 12-AQ + 12-AR: Background Function (Pro 플랜, timeout 15분) ────────────
// 호출 즉시 202 반환, Anthropic API 호출 후 결과를 Netlify Blobs에 저장
// 파일명에 `-background` 접미사 → 자동으로 background mode
// ★ 12-AR: 새 함수 포맷 (Web API Request/Response) — Blobs context 자동 주입

import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  // 1. POST 요청 검증
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { jobId, system, userMsg, max_tokens = 3500, model = "claude-sonnet-4-5" } = payload;

  if (!jobId || typeof jobId !== "string" || jobId.length < 8) {
    return new Response(JSON.stringify({ error: "jobId required (min 8 chars)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!system || !userMsg) {
    return new Response(JSON.stringify({ error: "system and userMsg required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Blobs store 연결 (자동 context 주입) + pending 마크
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
    return new Response(JSON.stringify({ error: "blobs store init failed: " + e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Background에서 Anthropic API 호출 (15분 timeout 가능)
  try {
    const apiKey = Netlify.env.get("ANTHROPIC_API_KEY") || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await store.setJSON(jobId, {
        status: "failed",
        error: "ANTHROPIC_API_KEY not configured",
        elapsedMs: Date.now() - t0,
      });
      return new Response(JSON.stringify({ ok: true, jobId, msg: "background started (config error)" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ ok: true, jobId }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
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

    return new Response(JSON.stringify({ ok: true, jobId, msg: "completed" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    await store.setJSON(jobId, {
      status: "failed",
      error: `exception: ${e?.message || String(e)}`.slice(0, 500),
      elapsedMs: Date.now() - t0,
    });
    return new Response(JSON.stringify({ ok: true, jobId, msg: "background failed" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  }
};
