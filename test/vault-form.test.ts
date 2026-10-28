import { expect, test } from "bun:test";
import { selectLoginForm, type LoginInput } from "../src/vault/form";

const username: LoginInput = { index: 0, type: "email", name: "email", visible: true, enabled: true, form: "login" };
const password: LoginInput = { index: 1, type: "password", name: "password", visible: true, enabled: true, form: "login" };

test("chooses one visible email and password pair in the same form", () => {
  expect(selectLoginForm([username, password])).toEqual({ usernameIndex: 0, passwordIndex: 1 });
});

test("rejects ambiguous, hidden, disabled and password-less forms", () => {
  expect(() => selectLoginForm([username, password, { ...password, index: 2 }])).toThrow();
  expect(() => selectLoginForm([username, { ...password, visible: false }])).toThrow();
  expect(() => selectLoginForm([{ ...username, enabled: false }, password])).toThrow();
  expect(() => selectLoginForm([username])).toThrow();
  expect(() => selectLoginForm([username, { ...password, form: "other" }])).toThrow();
});
