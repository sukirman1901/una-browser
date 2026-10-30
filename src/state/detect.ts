import type { PageSession } from "../cdp/session";
import { UnaError } from "../errors";

export type ChallengeKind = "cf" | "turnstile" | "hcaptcha" | "captcha" | "forbidden" | "rate" | null;
export type PageStateKind = "loaded" | "challenge" | "blocked";

export interface PageState {
  state: PageStateKind;
  kind: ChallengeKind;
}

export const DETECT_JS = `(() => {
  const t = (document.title || "").toLowerCase();
  const b = (document.body && document.body.innerText || "").slice(0, 800).toLowerCase();
  const h = (document.documentElement && document.documentElement.innerHTML || "");
  if (!h) return "unreadable";
  const vis = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    let n = el;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      n = n.parentElement;
    }
    return true;
  };
  const q = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel)).some(vis);
  if (q('[id*="cf-chl-"], [class*="cf-chl-"], #cf-browser-verification')) return "cf";
  if (/verify you are human/.test(b) || /checking your browser/.test(b) || /just a moment/.test(t) || /attention required/.test(t)) return "cf";
  if (q('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]')) return "turnstile";
  if (q(".h-captcha") || q("iframe[src*='hcaptcha.com']")) return "hcaptcha";
  if (q(".g-recaptcha") || q("iframe[src*='recaptcha']") || q(".rc-anchor")) return "captcha";
  if (/403|access denied|forbidden/.test(t) || /^(403|access denied|forbidden)\\b/.test(b.trim())) return "forbidden";
  if (/429|too many requests/.test(t) || /^(429|too many requests)\\b/.test(b.trim())) return "rate";
  return "loaded";
})()`;

export async function detectState(session: PageSession): Promise<PageState> {
  const res = await session.client.send("Runtime.evaluate", { expression: DETECT_JS, returnByValue: true });
  if (res.exceptionDetails) throw new UnaError("cdp", "challenge detector could not read the page", "re-observe the page before continuing");
  const code = (res.result as { value?: string } | undefined)?.value;
  switch (code) {
    case "cf": return { state: "challenge", kind: "cf" };
    case "turnstile": return { state: "challenge", kind: "turnstile" };
    case "hcaptcha": return { state: "challenge", kind: "hcaptcha" };
    case "captcha": return { state: "challenge", kind: "captcha" };
    case "forbidden": return { state: "blocked", kind: "forbidden" };
    case "rate": return { state: "blocked", kind: "rate" };
    case "loaded": return { state: "loaded", kind: null };
    default: throw new UnaError("cdp", "challenge detector returned an unreadable state", "re-observe the page before continuing");
  }
}
