# Local credential vault for una

## Goal and scope

Allow a person to save website, username or email, password, and notes locally and have una fill a matching login form on request from a CLI or MCP harness. A person initializes and unlocks the vault once per daemon session through an interactive CLI. Filling does not submit the form. Version 1 has no automatic capture, automatic fill on navigation, sync, password generation, or browser extension.

## Threat model and limits

Protect secrets at rest and keep them out of CLI arguments, shell history, MCP responses, agent transcripts, and ordinary daemon HTTP requests. Do not claim to protect secrets from malware running as the same OS user, a compromised website receiving an autofilled password, or a harness with access to una's `eval` or Chrome DevTools after the password has been inserted into the DOM. The existing daemon HTTP endpoint is unauthenticated; vault management and unlock must not be exposed there. Treat `vault fill` as an explicitly authorized browser action; matching a hostname alone is not proof that a page is trustworthy.

## Storage and lifecycle

Store a versioned encrypted vault in a private local directory (0700, file 0600). Each entry has a canonical HTTPS origin/hostname, account identifier, and encrypted username/email, password, and notes; avoid storing secret plaintext or derived keys in logs, errors, command arguments, or MCP outputs. Use a per-vault random salt, a memory-hard password KDF with documented parameters and an authenticated cipher with unique nonces; authenticate record identity and schema version as associated data. Verify the master passphrase against authenticated data. Reject malformed or incompatible vault formats safely; use atomic writes and do not clobber existing data on failed updates. Where practical, zero temporary buffers; acknowledge runtime GC prevents guaranteed memory erasure.

The person supplies the master passphrase via a hidden, local, interactive TTY prompt; adding credentials and notes likewise uses interactive input rather than arguments or environment variables. A local, OS-permissioned IPC channel carries sensitive management/unlock requests to the daemon; the ordinary una HTTP endpoint and MCP must not accept those operations. Unlocked key material stays in daemon memory for the daemon's lifetime or until explicit `vault lock`. Restarting daemon requires unlock again. The vault is shared by una installations for the same OS user, not by unrelated users.

## Command and MCP surface

- Interactive CLI: `una vault init`, `una vault add`, `una vault unlock`; provide safe list/edit/delete management via an interactive path as needed. `una vault lock` removes in-memory keys.
- Agent-visible CLI/MCP: `vault status`, `vault list` (nonsecret site/account labels only), and `vault fill` on the focused tab, with an explicit account selector if multiple accounts match. The fill result reports success or a nonsecret error, never username/password/notes.
- Enforce exact HTTPS hostname matching by default; no substring matching, lookalike-domain inference, or automatic parent-domain/subdomain expansion. Reject non-HTTPS pages, blocked/challenge pages, mismatched origins, and ambiguous accounts. Do not submit the form, and do not fill an unrecognized or ambiguous login form. Recheck URL/origin immediately before filling, and use the existing CDP browser session rather than passing the password through a page-eval return value. Document that browser/page scripting and CDP can still observe entered values.
- Preserve existing una CLI/MCP behaviors. Do not allow vault management through generic `batch`, `fuse`, or `/` commands, which inherit the una daemon's unauthenticated HTTP routing.

## Failure handling and verification

Wrong passphrase, locked vault, missing entry, ambiguous account/form, HTTP page, hostname mismatch, malformed database, and unavailable private IPC fail closed without a partial login or secret disclosure. Return actionable, nonsecret errors. Validate encryption round trips, tampering, wrong passphrase, atomic update and restrictive permissions; exercise hostname edge cases and multiple accounts; test browser filling against a local login fixture; assert no plaintext secret in CLI/MCP output or logs and that HTTP management/unlock routes are rejected. Do not use real Instagram credentials in tests.
