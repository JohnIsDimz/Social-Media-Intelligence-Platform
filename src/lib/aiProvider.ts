/**
 * AI provider layer.
 *
 * The product talks to one OpenAI-compatible chat-completions gateway instead of
 * a vendor SDK. Sakelar (https://app.sakelar.web.id) is the default: one key and
 * a model slug, `https://api.sakelar.web.id/v1`.
 *
 * Everything is configured by environment so switching providers is a config
 * change, not a code change:
 *
 *   AI_BASE_URL   default https://api.sakelar.web.id/v1
 *   AI_MODEL      default glm-5.3-flash
 *   AI_API_KEY    required to enable any AI feature
 *   AI_FORMAT     openai (default) | anthropic
 *
 * Two hard rules:
 *   1. No key means AI features are disabled, and the UI says so. We never
 *      pretend an analysis happened.
 *   2. A reply is only trusted after it parses as JSON. Prose, a truncated
 *      answer, or an HTML error page is a failure, not a result.
 */

export interface AiConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  format: "openai" | "anthropic";
  /** Human-readable provider host, for the UI and the health report. */
  host: string;
}

const DEFAULT_BASE_URL = "https://api.sakelar.web.id/v1";
const DEFAULT_MODEL = "glm-5.3-flash";

const PLACEHOLDERS = new Set([
  "YOUR_API_KEY",
  "missing_api_key_placeholder",
]);

export function aiConfig(): AiConfig {
  const rawKey = (process.env.AI_API_KEY || "").trim();
  const baseUrl = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const model = (process.env.AI_MODEL || DEFAULT_MODEL).trim();
  const format = (process.env.AI_FORMAT || "openai").trim() === "anthropic" ? "anthropic" : "openai";

  let host = baseUrl;
  try {
    host = new URL(baseUrl).host;
  } catch {
    /* keep the raw string; validation happens on the request */
  }

  const enabled =
    rawKey.length > 0 && !PLACEHOLDERS.has(rawKey) && !rawKey.startsWith("YOUR_");

  return { enabled, baseUrl, model, format, host };
}

export class AiError extends Error {
  status: number;
  kind: "auth" | "rate-limit" | "unavailable" | "bad-response" | "disabled" | "network";

  constructor(message: string, kind: AiError["kind"], status = 0) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = status;
  }
}

interface ChatOptions {
  /** Instruction block; becomes the system message. */
  system: string;
  /** The actual task. */
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Sends one chat completion and returns the raw assistant text.
 * Throws `AiError` with a classified reason so callers can degrade honestly.
 */
export async function chatText(options: ChatOptions): Promise<string> {
  const config = aiConfig();
  if (!config.enabled) {
    throw new AiError(
      "No AI key is configured (AI_API_KEY).",
      "disabled"
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isAnthropic = config.format === "anthropic";
  const url = isAnthropic ? `${config.baseUrl}/messages` : `${config.baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (isAnthropic) {
    headers["x-api-key"] = process.env.AI_API_KEY || "";
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${process.env.AI_API_KEY || ""}`;
  }

  const body: any = isAnthropic
    ? {
        model: config.model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.2,
        system: options.system,
        messages: [{ role: "user", content: options.prompt }],
      }
    : {
        model: config.model,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 2048,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.prompt },
        ],
      };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      throw new AiError(`The model did not answer within ${timeoutMs / 1000}s.`, "unavailable");
    }
    throw new AiError(
      `Could not reach ${config.host}: ${err?.cause?.code || err?.message || "network error"}`,
      "network"
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();

  if (!response.ok) {
    const kind: AiError["kind"] =
      response.status === 401 || response.status === 403
        ? "auth"
        : response.status === 429
          ? "rate-limit"
          : "unavailable";
    // Gateway errors are short JSON like {"error":{"message":...}}.
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message || parsed?.message || detail;
    } catch {
      /* keep the raw snippet */
    }
    throw new AiError(
      `${config.host} returned ${response.status}: ${detail}`,
      kind,
      response.status
    );
  }

  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AiError("The model host returned a non-JSON envelope.", "bad-response");
  }

  const content = isAnthropic
    ? Array.isArray(payload?.content)
      ? payload.content.map((part: any) => part?.text || "").join("")
      : ""
    : payload?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim() === "") {
    throw new AiError("The model returned an empty message.", "bad-response");
  }
  return content;
}

/** Pulls the first JSON value out of a reply, tolerating ```json fences and prose. */
export function extractJson<T = any>(raw: string): T {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* fall through to bracket scanning */
  }

  const start = candidate.search(/[[{]/);
  if (start === -1) {
    throw new AiError("The model reply contained no JSON.", "bad-response");
  }
  const opener = candidate[start];
  const closer = opener === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(closer);
  if (end <= start) {
    throw new AiError("The model reply contained incomplete JSON.", "bad-response");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch (err: any) {
    throw new AiError(`The model reply was not valid JSON: ${err?.message}`, "bad-response");
  }
}

/** `chatText` + `extractJson`: the only way the app ever reads a model answer. */
export async function chatJson<T = any>(options: ChatOptions & { expectation: string }): Promise<T> {
  const raw = await chatText({
    ...options,
    system: `${options.system}\n\nReply with a single JSON value ${options.expectation}. No prose, no markdown fences.`,
  });
  return extractJson<T>(raw);
}

/** Ready for `/api/health` and the data-sources dialog. */
export function aiSummary() {
  const config = aiConfig();
  return {
    enabled: config.enabled,
    provider: config.host,
    model: config.model,
    baseUrl: config.baseUrl,
    format: config.format,
  };
}
