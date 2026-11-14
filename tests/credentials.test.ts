/**
 * Credentials are env-only.
 *
 * Two layers are asserted here: the scanner refuses a write that carries a
 * secret, and the running app actually answers 400 when one arrives. The second
 * layer matters because a guard that is never mounted is just a comment.
 */
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.TRUST_PROXY = "false";
process.env.PORT = "3161";
process.env.NODE_ENV = "production";
delete process.env.API_AUTH_TOKEN; // keep the write path open for this test

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

const BASE = "http://127.0.0.1:3161";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("server did not start");
}

async function main() {
  const { findCredentialWrites, SECRET_ENV_VARS, credentialReport } = await import(
    "../src/server/credentials.ts"
  );

  // 1. Scanner behaviour.
  check(
    "a field named like a secret is refused",
    findCredentialWrites({ apiKey: "x", AI_API_KEY: "sk-abc" }).length === 1
  );
  check(
    "a secret pasted into an innocent field is refused",
    findCredentialWrites({ note: "here is my key AI_API_KEY=sk-live-123" }).length === 1
  );
  check(
    "a normal tracker payload passes",
    findCredentialWrites({ type: "brand", query: "nike", platforms: ["reddit"] }).length === 0
  );
  check(
    "the login token field is allowed",
    findCredentialWrites({ token: "some-token" }).length === 0
  );
  check(
    "credentials are reported as env-sourced, never valued",
    credentialReport().every((c) => c.from === "env" && typeof c.present === "boolean")
  );
  check("the secret list covers every key the app reads", SECRET_ENV_VARS.includes("AI_API_KEY") && SECRET_ENV_VARS.includes("SEARCH_API_KEY"));

  // 2. The mounted guard.
  await import("../server");
  await waitForServer();

  const withKey = await fetch(`${BASE}/api/trackers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "brand", query: "nike", AI_API_KEY: "sk-should-not-be-accepted" }),
  });
  const body = await withKey.json();
  check("POST carrying a secret is rejected", withKey.status === 400, String(withKey.status));
  check("the rejection names the reason", body.reason === "credentials-not-accepted", body.reason);
  check("the rejection names the offending field", Array.isArray(body.fields) && body.fields.includes("AI_API_KEY"));

  const clean = await fetch(`${BASE}/api/trackers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "brand", query: "nike" }),
  });
  check("a clean write is not blocked by the guard", clean.status !== 400, String(clean.status));

  // 3. No client surface can collect a key.
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const clientFiles = walk("src").filter((f) => /\.(tsx?|jsx?)$/.test(f));
  const offenders = clientFiles.filter((f) => {
    const text = readFileSync(f, "utf8");
    // A password input outside the server-rendered login page would be a key field.
    return /type="password"/.test(text) || /localStorage\.setItem\([^)]*api/i.test(text);
  });
  check("no client component renders a password or key field", offenders.length === 0, offenders.join(", "));

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
