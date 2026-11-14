/**
 * Session auth: the dashboard must be reachable without shipping the token to
 * the browser, and the API must reject writes without a credential.
 *
 * Runs against a real server on an ephemeral port with API_AUTH_TOKEN set, so
 * the cookie flow and the bearer flow are both exercised end to end.
 */
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
process.env.TRUST_PROXY = "false";
process.env.PORT = "3141";
process.env.API_AUTH_TOKEN = "test-token-abcdef";
process.env.NODE_ENV = "production";
delete process.env.SMIP_NO_LISTEN;

const BASE = "http://127.0.0.1:3141";
const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error("server did not start");
}

async function main() {
  await import("../server");
  await waitForServer();

  // 1. The dashboard is gated, not merely the API.
  const root = await fetch(`${BASE}/`, { redirect: "manual" });
  const location = root.headers.get("location") || "";
  check("anonymous visit to / is redirected to /login", root.status === 302 && location.endsWith("/login"), `${root.status} ${location}`);

  // 2. The sign-in page itself is served.
  const loginPage = await fetch(`${BASE}/login`);
  const html = await loginPage.text();
  check("the sign-in page renders a token form", loginPage.status === 200 && html.includes('name="token"'));
  check("the sign-in page never contains the token", !html.includes("test-token-abcdef"));

  // 3. A wrong token does not create a session.
  const wrong = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "token=wrong",
    redirect: "manual",
  });
  check("a wrong token is refused", wrong.status === 302 && (wrong.headers.get("location") || "").includes("e=1"));
  check("a refused sign-in sets no cookie", !wrong.headers.get("set-cookie"));

  // 4. The right token sets an HttpOnly session cookie that is not the token.
  const right = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "token=test-token-abcdef",
    redirect: "manual",
  });
  const setCookie = right.headers.get("set-cookie") || "";
  check("a correct token signs in", right.status === 302 && setCookie.includes("smip_session="));
  check("the cookie is HttpOnly and SameSite=Strict", setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Strict"));
  check("the cookie does not contain the raw token", !setCookie.includes("test-token-abcdef"));

  const cookie = setCookie.split(";")[0];

  // 5. With the session, the dashboard and writes are allowed.
  const authedRoot = await fetch(`${BASE}/`, { headers: { Cookie: cookie }, redirect: "manual" });
  check("the dashboard loads with a session", authedRoot.status === 200, String(authedRoot.status));

  const writeWithSession = await fetch(`${BASE}/api/trackers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ type: "brand", query: "nike" }),
  });
  // 503 is the expected database answer here; 401 would mean the session failed.
  check("a session authorises a write", writeWithSession.status !== 401, String(writeWithSession.status));

  // 6. Bearer keeps working for scripts.
  const writeWithBearer = await fetch(`${BASE}/api/trackers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-abcdef" },
    body: JSON.stringify({ type: "brand", query: "adidas" }),
  });
  check("a bearer token authorises a write", writeWithBearer.status !== 401, String(writeWithBearer.status));

  // 7. No credential means no write, and a forged cookie is not a wildcard.
  const noAuth = await fetch(`${BASE}/api/trackers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "brand", query: "nike" }),
  });
  const noAuthBody = await noAuth.json();
  check("a write without credentials is refused", noAuth.status === 401 && noAuthBody.reason === "unauthorized");

  const forged = await fetch(`${BASE}/api/trackers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "smip_session=0123456789abcdef" },
    body: JSON.stringify({ type: "brand", query: "nike" }),
  });
  check("a forged cookie is refused", forged.status === 401);

  // 8. Reads stay public for uptime monitors. This server is pointed at a
  // closed port, so 503 with reason "unreachable" is the correct answer: it
  // proves the request was served rather than rejected by the auth guard.
  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await health.json().catch(() => ({}));
  check(
    "GET /api/health stays public",
    health.status === 200 || (health.status === 503 && healthBody?.database?.configured === true),
    `${health.status} reason=${healthBody?.database?.reason}`
  );

  // 9. Logout clears the cookie.
  const logout = await fetch(`${BASE}/logout`, { redirect: "manual" });
  check("logout expires the cookie", (logout.headers.get("set-cookie") || "").includes("Max-Age=0"));

  console.log(results.join("\n"));
  const failed = results.filter((r) => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
