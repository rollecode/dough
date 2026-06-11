// Minimal Gemini text client for fast, cheap routine tasks (categorization). Thinking is
// disabled (thinkingBudget: 0) so a short answer returns in well under a second.
export async function geminiText(
  prompt: string,
  apiKey: string,
  model = "gemini-2.5-flash",
  maxOutputTokens = 40
): Promise<string | null> {
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
  });
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn("[gemini] HTTP", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === "string" ? text.trim() : null;
  } catch (err) {
    console.warn("[gemini] request failed:", err);
    return null;
  }
}
