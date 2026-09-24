import type { PageSession } from "../cdp/session";

export type ChallengeKind = "cf" | "hcaptcha" | "captcha" | "forbidden" | "rate" | null;
export type PageStateKind = "loaded" | "challenge" | "blocked";

export interface PageState {
  state: PageStateKind;
  kind: ChallengeKind;
}

const DETECT_JS = `(() => {
  const t = (document.title || "").toLowerCase();
  const b = (document.body && document.body.innerText || "").slice(0, 800).toLowerCase();
  const h = (document.documentElement && document.documentElement.innerHTML || "");
  if (!h) return "loaded";
  if (h.includes("cf-chl-") || h.includes("cf-browser-verification")) return "cf";
  if (h.includes("challenges.cloudflare.com")) return "cf";
  if (h.includes("hcaptcha.com") || h.includes("h-captcha")) return "hcaptcha";
  if (h.includes("g-recaptcha") || h.includes("recaptcha")) return "captcha";
  if (/verify you are human/.test(b) || /checking your browser/.test(b) || /just a moment/.test(t) || /attention required/.test(t)) return "cf";
  if (/403|access denied|forbidden/.test(b) || /403|forbidden/.test(t)) return "forbidden";
  if (/429|too many requests/.test(b) || /429/.test(t)) return "rate";
  return "loaded";
})()`;

export async function detectState(session: PageSession): Promise<PageState> {
  const res = await session.client.send("Runtime.evaluate", { expression: DETECT_JS, returnByValue: true });
  if (res.exceptionDetails) return { state: "loaded", kind: null };
  const code = (res.result as { value?: string }).value ?? "loaded";
  switch (code) {
    case "cf": return { state: "challenge", kind: "cf" };
    case "hcaptcha": return { state: "challenge", kind: "hcaptcha" };
    case "captcha": return { state: "challenge", kind: "captcha" };
    case "forbidden": return { state: "blocked", kind: "forbidden" };
    case "rate": return { state: "blocked", kind: "rate" };
    default: return { state: "loaded", kind: null };
  }
}