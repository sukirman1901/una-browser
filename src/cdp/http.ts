import { UnaError } from "../errors";

export async function cdpHttp<T>(port: number, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`);
  } catch {
    throw new UnaError("cdp", `CDP HTTP ${path} unreachable`, "is Chrome running? start with: una serve");
  }
  if (!res.ok) throw new UnaError("cdp", `CDP HTTP ${path} -> ${res.status}`);
  return (await res.json()) as T;
}