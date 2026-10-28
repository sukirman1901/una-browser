export function normalizeOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) throw new Error("vault requires a plain HTTPS origin");
  return url.origin;
}

export function matchesOrigin(saved: string, current: string): boolean {
  try { return normalizeOrigin(saved) === normalizeOrigin(current); }
  catch { return false; }
}
