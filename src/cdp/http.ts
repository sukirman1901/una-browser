import { UnaError } from "../errors";

export async function cdpFetch<T>(port: number, path: string, init?: { method?: string; body?: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, { method: init?.method ?? "GET", body: init?.body });
  } catch {
    throw new UnaError("cdp", `CDP HTTP ${path} unreachable`, "is Chrome running? start with: una serve");
  }
  if (!res.ok) throw new UnaError("cdp", `CDP HTTP ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export function cdpHttp<T>(port: number, path: string): Promise<T> {
  return cdpFetch<T>(port, path);
}

export interface CdpNewTabResult {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

export async function cdpNewTab(port: number, url: string): Promise<CdpNewTabResult> {
  const path = `/json/new?${encodeURIComponent(url)}`;
  try {
    return await cdpFetch<CdpNewTabResult>(port, path, { method: "PUT" });
  } catch (err) {
    if (err instanceof UnaError && /-> 405/.test(err.message)) {
      return await cdpFetch<CdpNewTabResult>(port, path);
    }
    throw err;
  }
}