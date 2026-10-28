import { expect, test } from "bun:test";
import { normalizeOrigin, matchesOrigin } from "../src/vault/match";

test("matches only the same HTTPS origin, ignoring path and case", () => {
  const saved = normalizeOrigin("https://WWW.Instagram.com/accounts/login/");
  expect(saved).toBe("https://www.instagram.com");
  expect(matchesOrigin(saved, "https://www.instagram.com/login/?next=%2F")).toBe(true);
});

test("rejects insecure and lookalike origins", () => {
  const saved = normalizeOrigin("https://instagram.com/");
  for (const url of ["http://instagram.com", "https://instagram.com.evil.test", "https://www.instagram.com", "https://instagrаm.com", "https://instagram.com:444", "https://instagram.com@evil.test"]) {
    expect(matchesOrigin(saved, url)).toBe(false);
  }
  expect(() => normalizeOrigin("http://instagram.com")).toThrow();
  expect(() => normalizeOrigin("https://user:pass@instagram.com")).toThrow();
});
