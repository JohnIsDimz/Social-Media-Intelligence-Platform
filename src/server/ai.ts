/**
 * AI availability.
 *
 * One OpenAI-compatible gateway (Sakelar by default, model glm-5.3-flash)
 * replaces the Gemini SDK. No key means no AI: the UI is told, nothing is faked.
 *
 * The cooldown is process-wide: when the provider answers 429 every route that
 * uses AI backs off, instead of each request discovering the limit on its own.
 */
import { aiConfig, AiError } from "../lib/aiProvider.ts";

/* ---------------------------------------------------------------------------
 * AI provider
 *
 * One OpenAI-compatible gateway (Sakelar by default, model glm-5.3-flash)
 * replaces the Gemini SDK. No key means no AI: the UI is told, nothing is faked.
 * ------------------------------------------------------------------------- */

let aiCooldownUntil = 0;

/** True when a key exists and no rate-limit cooldown is in force. */
export function isAiAvailable(): boolean {
  const config = aiConfig();
  if (!config.enabled) return false;
  if (Date.now() < aiCooldownUntil) return false;
  return true;
}

/** Readability alias used at the collection call sites. */
export function aiCanSearch(): boolean {
  return isAiAvailable();
}

export function startAiCooldown(ms = 120_000) {
  aiCooldownUntil = Date.now() + ms;
}

/** Classifies provider failures so the caller can log and degrade correctly. */
export function describeAiFailure(err: unknown): string {
  if (err instanceof AiError) {
    if (err.kind === "rate-limit") startAiCooldown();
    return `[${err.kind}] ${err.message}`;
  }
  return String((err as any)?.message || err);
}
