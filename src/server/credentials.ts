/**
 * Credentials are configuration, not content.
 *
 * Every key this app uses (AI_API_KEY, SEARCH_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * YOUTUBE_API_KEY, TWITTER_BEARER_TOKEN, GITHUB_TOKEN, the Reddit and Twitch app
 * pairs, API_AUTH_TOKEN) is read from the process environment. There is deliberately no endpoint, no form field
 * and no storage key that accepts one at runtime:
 *
 *   - an API key typed into a browser field would end up in the bundle, the
 *     database or a log, and would survive a redeploy that was meant to rotate it;
 *   - a key stored in the database turns a data leak into a credential leak.
 *
 * This module is the executable version of that rule, and the test suite keeps
 * it honest. The single exception is the sign-in form, which accepts
 * API_AUTH_TOKEN to start a browser session — see the note on ALLOWED_FIELDS.
 */

/** Environment variables that hold a secret, and therefore have no UI. */
export const SECRET_ENV_VARS = [
  "AI_API_KEY",
  "SEARCH_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "YOUTUBE_API_KEY",
  "TWITTER_BEARER_TOKEN",
  "GITHUB_TOKEN",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "API_AUTH_TOKEN",
] as const;

/**
 * Request keys that may legitimately carry a credential-shaped value.
 *
 * `token` exists only on POST /login, which compares it against API_AUTH_TOKEN
 * and stores nothing but an HMAC of it in a cookie. It is not an API-key form and
 * it does not persist a key anywhere the app reads back.
 */
export const ALLOWED_FIELDS = new Set(["token"]);

const SECRET_ENV_PATTERN = new RegExp(
  SECRET_ENV_VARS.map((name) => `${name}(?![A-Z_])`).join("|")
);

export interface KeyWriteAttempt {
  location: string;
  field: string;
  reason: string;
}

/**
 * Scans a request body for attempts to store a credential.
 *
 * Returns the offending field names. Callers reject the request with 400 rather
 * than silently dropping the value, so a client author learns immediately that
 * keys belong in .env.
 */
export function findCredentialWrites(body: unknown): KeyWriteAttempt[] {
  const attempts: KeyWriteAttempt[] = [];
  if (!body || typeof body !== "object") return attempts;

  for (const [field, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (ALLOWED_FIELDS.has(field)) continue;

    // A field named like a secret, or a value that looks like one, is refused.
    if (SECRET_ENV_PATTERN.test(field) || SECRET_ENV_PATTERN.test(value)) {
      attempts.push({
        location: field,
        field,
        reason: "API keys are read from the environment (.env) and cannot be submitted.",
      });
    }
  }

  return attempts;
}

/**
 * Human-readable list of where each secret comes from, for the Data sources
 * dialog and /api/health. Never returns a value, only whether it is set.
 */
export function credentialReport(): Array<{ name: string; from: "env"; present: boolean }> {
  return SECRET_ENV_VARS.map((name) => ({
    name,
    from: "env" as const,
    present: Boolean((process.env[name] || "").trim()),
  }));
}
