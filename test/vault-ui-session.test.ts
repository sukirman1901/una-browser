import { expect, test } from "bun:test";
import { UiSessions } from "../src/vault/ui-session";

test("browser session expires after 15 minutes without activity", () => {
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    const sessions = new UiSessions();
    const { id } = sessions.create(true);
    now += 14 * 60_000;
    expect(sessions.get(id)?.authenticated).toBe(true);
    now += 15 * 60_000;
    expect(sessions.get(id)).toBeUndefined();
  } finally { Date.now = clock; }
});
