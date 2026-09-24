import type { Server } from "bun";

let clicks = 0;

const PAGE = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const HTML = (body: string) => PAGE("UnaFixture", body);

const page2 = () => PAGE("PageTwo", `<h1>Page Two</h1><a href="/" id="back">Back</a>`);
const page3 = () => PAGE("PageThree", `<h1>Page Three</h1>`);

const landing = () => HTML(`
<h1>Una Fixture</h1>
<a href="/form" id="toForm">Go to form</a>
<button id="btn" onclick="document.getElementById('count').textContent='Clicks: ' + (++window.__c || (window.__c=1))">Increment</button>
<p id="count" role="status">Clicks: ${clicks}</p>
<div id="secret" style="display:none">hidden text</div>
<button id="swap" onclick="this.outerHTML='<button id=swapped>Swapped</button>'">Swap</button>
<input type="checkbox" id="opt" checked> <label for="opt">Opt in</label>
<img id="logo" alt="Una logo" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
`);

const form = () => HTML(`
<h2>Form</h2>
<input id="name" type="text" placeholder="Your name">
<textarea id="bio"></textarea>
<select id="city"><option value="jkt">Jakarta</option><option value="bdo">Bandung</option></select>
<button id="submit" onclick="document.getElementById('result').textContent='OK ' + document.getElementById('name').value">Submit</button>
<p id="result"></p>
`);

const CF_PAGE = () => `<!doctype html><html><head><title>Just a moment...</title></head><body><div class="cf-body"><div class="cf-chl-container"><div id="challenge-form"><label>Enable JavaScript and cookies to continue</label><form action="/cgi-sys/cf_chi" method="post"><input type="hidden" name="t" value="…"><input type="submit" value="Verify you are human"></form></div></div></div></body></html>`;

const TURNSTILE_PAGE = () => HTML(`<h1>Checkpoint</h1><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/scripts/jsd/main.js"></iframe>`);

const HCAPTCHA_PAGE = () => HTML(`<h1>Verify</h1><div class="h-captcha" data-sitekey="x" style="width:300px;height:65px;border:1px solid #ccc"></div><script src="https://hcaptcha.com/1/api.js"></script>`);

const INBOX_HIDDEN_RECAPTCHA_PAGE = () => `<!doctype html><html><head><title>Inbox - Gmail</title><script src="https://www.google.com/recaptcha/api.js" defer></script></head><body><div class="nH" role="navigation">Inbox</div><div class="tl">3 new messages</div><div class="g-recaptcha" data-sitekey="x" style="display:none"></div></body></html>`;

const CHALLENGE_RECAPTCHA_PAGE = () => HTML(`<h1>One more step</h1><div class="g-recaptcha" data-sitekey="x" style="width:300px;height:70px;border:1px solid #ccc"></div><script src="https://www.google.com/recaptcha/api.js"></script>`);

const BLOCK_403_PAGE = () => HTML(`<h1>403 Forbidden</h1><p>Access denied by server policy.</p>`);

const BLOCK_429_PAGE = () => HTML(`<h1>429 Too Many Requests</h1><p>Slow down and try again later.</p>`);

const AUTO_PASS_PAGE = () => {
  const inner = HTML(`<h1>Auto-cleared</h1>`);
  return `<!doctype html><html><head><title>Just a moment...</title><script>setTimeout(() => { document.title = "Auto-cleared"; document.body.innerHTML = "<h1>Auto-cleared</h1>"; }, 1200);</script></head><body><div class="cf-chl-container"></div><p>Checking your browser before accessing.</p></body></html>`;
};

export function startFixture(port = 0): Promise<Server<undefined>> {
  return new Promise((resolve) => {
    const server = Bun.serve({
      port,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/slow") {
          return new Promise((r) => setTimeout(() => r(new Response(HTML("<h1>Slow done</h1>"))), 700));
        }
        if (u.pathname === "/slow2") {
          return new Promise((r) => setTimeout(() => r(new Response(page2()))), 600);
        }
        if (u.pathname === "/page2") return new Response(page2(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/page3") return new Response(page3(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/form") return new Response(form(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/count") return new Response(String(clicks));
        if (u.pathname === "/setcookie") {
          return new Response(HTML(`<p>cookie set</p>`), { headers: { "content-type": "text/html", "set-cookie": "una_ident=persisted; Path=/" } });
        }
        if (u.pathname === "/challenge-cf") return new Response(CF_PAGE(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/challenge-turnstile") return new Response(TURNSTILE_PAGE(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/challenge-hcaptcha") return new Response(HCAPTCHA_PAGE(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/block-403") return new Response(BLOCK_403_PAGE(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/block-429") return new Response(BLOCK_429_PAGE(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/challenge-auto") return new Response(AUTO_PASS_PAGE(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/inbox-hidden-recaptcha") return new Response(INBOX_HIDDEN_RECAPTCHA_PAGE(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/challenge-recaptcha") return new Response(CHALLENGE_RECAPTCHA_PAGE(), { headers: { "content-type": "text/html" } });
        clicks = 0;
        return new Response(landing(), { headers: { "content-type": "text/html" } });
      },
    });
    resolve(server);
  });
}