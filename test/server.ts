import type { Server } from "bun";

let clicks = 0;

const HTML = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>UnaFixture</title></head><body>${body}</body></html>`;

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

export function startFixture(port = 0): Promise<Server<undefined>> {
  return new Promise((resolve) => {
    const server = Bun.serve({
      port,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/slow") {
          return new Promise((r) => setTimeout(() => r(new Response(HTML("<h1>Slow done</h1>"))), 700));
        }
        if (u.pathname === "/form") return new Response(form(), { headers: { "content-type": "text/html" } });
        if (u.pathname === "/count") return new Response(String(clicks));
        clicks = 0;
        return new Response(landing(), { headers: { "content-type": "text/html" } });
      },
    });
    resolve(server);
  });
}