// netlify/functions/whapi-webhook-proxy.js
// ─── Whapi → Apps Script 프록시 (Phase B-1) ──────────────────────────────────
// 역할:
//   1. Whapi가 보낸 Webhook 수신
//   2. Apps Script Web App의 302 redirect 자동 처리 (fetch redirect: "follow")
//   3. Apps Script로 그대로 전달 후 응답 반환
//   4. 추가 보안 검증 + 로깅
//
// ── 환경변수 (Netlify Site configuration → Environment variables) ──
//   APPS_SCRIPT_WEBHOOK_URL   = https://script.google.com/macros/s/.../exec
//   APPS_SCRIPT_SECRET        = (Apps Script Properties의 SHARED_SECRET과 동일)
//   WHAPI_PROXY_SECRET        = (Whapi가 우리 Netlify URL 호출 시 인증용 — 별도 secret)
//
// ── Whapi에 등록할 URL ──
//   https://YOUR-SITE.netlify.app/.netlify/functions/whapi-webhook-proxy?secret=WHAPI_PROXY_SECRET

export default async (req, context) => {
  const startMs = Date.now();

  // 1. POST만 허용
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. 환경변수 체크
  const APPS_SCRIPT_URL = Netlify.env.get("APPS_SCRIPT_WEBHOOK_URL") || process.env.APPS_SCRIPT_WEBHOOK_URL;
  const APPS_SCRIPT_SECRET = Netlify.env.get("APPS_SCRIPT_SECRET") || process.env.APPS_SCRIPT_SECRET;
  const WHAPI_PROXY_SECRET = Netlify.env.get("WHAPI_PROXY_SECRET") || process.env.WHAPI_PROXY_SECRET;

  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "Server misconfigured (env)" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Whapi → 프록시 인증 (?secret=WHAPI_PROXY_SECRET)
  if (WHAPI_PROXY_SECRET) {
    const url = new URL(req.url);
    const submittedSecret = url.searchParams.get("secret") || "";
    if (submittedSecret !== WHAPI_PROXY_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized (proxy)" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // 4. Whapi payload 받기
  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON from Whapi" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 5. Apps Script로 forward (302 redirect 자동 처리)
  const targetUrl = `${APPS_SCRIPT_URL}?secret=${encodeURIComponent(APPS_SCRIPT_SECRET)}`;
  let appsScriptResponse;
  try {
    appsScriptResponse = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "follow",  // ★ 핵심: 302를 자동으로 따라감
    });
  } catch (e) {
    console.error("[프록시] Apps Script forward 실패:", e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: `Apps Script unreachable: ${e?.message || e}`.slice(0, 300) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 6. Apps Script 응답 받아서 그대로 반환
  const responseText = await appsScriptResponse.text();
  const elapsedMs = Date.now() - startMs;

  if (!appsScriptResponse.ok) {
    console.error(`[프록시] Apps Script HTTP ${appsScriptResponse.status} (${elapsedMs}ms): ${responseText.slice(0, 300)}`);
    return new Response(JSON.stringify({
      ok: false,
      error: `Apps Script returned HTTP ${appsScriptResponse.status}`,
      detail: responseText.slice(0, 300),
      elapsed_ms: elapsedMs,
    }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 정상 — Apps Script JSON 응답을 그대로 패스스루
  // 진단 로깅 (간단)
  let parsedResp = {};
  try {
    parsedResp = JSON.parse(responseText);
  } catch (e) {
    // JSON 아닌 응답 (드물지만 가능) — 로그만 남기고 그대로 전달
    console.warn(`[프록시] Apps Script 응답이 JSON 아님 (${elapsedMs}ms): ${responseText.slice(0, 200)}`);
  }
  if (parsedResp && (parsedResp.errors > 0 || parsedResp.dropped > 0)) {
    console.log(`[프록시] (${elapsedMs}ms) Apps Script 응답:`, JSON.stringify(parsedResp).slice(0, 200));
  }

  return new Response(responseText, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// GET (헬스 체크용) — 인증 필요
export const config = {
  path: "/.netlify/functions/whapi-webhook-proxy",
};
