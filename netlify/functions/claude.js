export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }
  try {
    // ★ model 파라미터 추가 (기본값: claude-sonnet-4-5)
    const { system, userMsg, max_tokens = 1000, model } = JSON.parse(event.body);

    // ★ 모델 화이트리스트 (보안 + 오타 방지)
    const ALLOWED_MODELS = [
      "claude-sonnet-4-5",
      "claude-haiku-4-5-20251001",
      "claude-haiku-4-5",
    ];
    const useModel = ALLOWED_MODELS.includes(model) ? model : "claude-sonnet-4-5";

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: useModel,
        max_tokens,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: data.error?.message || "API 오류" }),
      };
    }
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
