/**
 * Network audit — "which APIs are dead?".
 *
 * Answered by actually calling each endpoint rather than trusting a comment.
 * Results are cached for a minute so opening the dialog repeatedly does not
 * hammer anyone, and a host with no internet is reported as "unverified"
 * instead of marking every channel down.
 */
import { CHANNEL_SPECS } from "../channels.ts";
import { aiSummary } from "../lib/aiProvider.ts";
import { dbStatus } from "../lib/supabaseDb.ts";
import { logger } from "./logger.ts";
import { searchConfig } from "./search.ts";

/* ---------------------------------------------------------------------------
 * Network audit
 *
 * "Which APIs are dead?" is answered by actually calling each endpoint, not by
 * trusting a comment. Results are cached for a minute so opening the dialog
 * repeatedly does not hammer anyone.
 * ------------------------------------------------------------------------- */

export interface ChannelHealth {
  status:
    | "configured"
    | "public"
    | "grounding"
    | "needs-key"
    | "closed"
    | "planned"
    | "down"
    | "unverified";
  detail: string;
}

/**
 * Can this host reach the internet at all?
 *
 * Without this check a firewalled server looks identical to a world where every
 * social API is dead. Probing two unrelated, highly available hosts tells us
 * whether a failure is the network's fault or the endpoint's.
 */
export async function detectEgress(): Promise<boolean> {
  const targets = ["https://registry.npmjs.org/-/ping", "https://api.github.com/zen"];
  for (const target of targets) {
    try {
      const res = await fetch(target, { method: "GET", signal: AbortSignal.timeout(5000) });
      if (res.status > 0) return true;
    } catch {
      /* try the next target */
    }
  }
  return false;
}

let healthCache: { at: number; payload: any } | null = null;
const HEALTH_TTL_MS = 60_000;

export async function probeEndpoint(spec: { endpoint?: string; okStatus?: number[] }) {
  if (!spec.endpoint) return { reachable: false, status: 0, error: "no endpoint" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(spec.endpoint, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "SMIP-Health/1.1", Accept: "application/json, application/xml;q=0.9,*/*;q=0.8" },
    });
    const okStatuses = spec.okStatus ?? [200, 201, 400, 401, 403];
    return {
      reachable: true,
      // A 401/403 still proves the network is alive: the host answered.
      status: response.status,
      healthy: okStatuses.includes(response.status) || (response.status > 0 && response.status < 500 && response.status !== 404),
    };
  } catch (err: any) {
    return { reachable: false, status: 0, error: err?.cause?.code || err?.message || "network error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function buildChannelHealth(force = false) {
  if (!force && healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) {
    return healthCache.payload;
  }

  const ai = aiSummary();
  const search = searchConfig();
  // A channel without a public read API needs BOTH legs: a search provider to
  // find the pages, and a model to extract mentions from them.
  const grounding = ai.enabled && search.configured;
  const egress = await detectEgress();
  const channels: Record<string, ChannelHealth> = {};

  await Promise.all(
    CHANNEL_SPECS.map(async (spec) => {
      // A credential listed for a channel is optional when the endpoint still
      // answers without it (YouTube RSS, anonymous Reddit). The probe decides:
      // a reachable endpoint means the channel collects, key or no key.
      const hasCredential = spec.credential
        ? spec.credential.split("+").every((c) => Boolean(process.env[c.trim()]))
        : true;

      if (spec.kind === "grounding") {
        const missing: string[] = [];
        if (!search.configured) missing.push("a web search provider (SEARCH_PROVIDER + SEARXNG_URL or SEARCH_API_KEY)");
        if (!ai.enabled) missing.push("an AI key (AI_API_KEY) for extraction");

        channels[spec.key] = {
          status: grounding ? "grounding" : "needs-key",
          detail: grounding
            ? `No public read API. Found by ${search.provider} search, extracted by ${ai.provider} (${ai.model}): ${spec.collects}.`
            : `No public read API. Needs ${missing.join(" and ")} to collect ${spec.collects}.`,
        };
        return;
      }

      if (spec.kind === "none") {
        // No collector exists for this channel. Say that plainly instead of
        // letting a reachable endpoint imply coverage that is not there, and keep
        // it visually distinct from a channel that is genuinely private.
        channels[spec.key] = {
          status: "planned",
          detail: spec.endpoint
            ? `Not built yet, so nothing is collected — no key unlocks this. Endpoint is ${new URL(spec.endpoint).host} if a collector is added.`
            : `Not built yet: ${spec.collects}.`,
        };
        return;
      }

      if (!egress) {
        // The server itself is offline. Judging the vendor API would be a lie.
        channels[spec.key] = {
          status: "unverified",
          detail: spec.credential
            ? `Cannot be tested: this server has no outbound internet. ${spec.credential} will be needed once it does.`
            : `Cannot be tested: this server has no outbound internet. Endpoint is ${new URL(spec.endpoint!).host}.`,
        };
        return;
      }

      // A channel whose credential is missing is only "needs-key" when the
      // endpoint itself refuses anonymous access. YouTube's RSS feed and Reddit's
      // anonymous search answer without a key, so they must not be filed as
      // blocked; the probe below decides, and the key is mentioned as an upgrade.
      if (spec.credential && !hasCredential) {
        const probe = await probeEndpoint(spec);
        const worksAnonymously =
          probe.reachable && (probe.healthy || (probe.status > 0 && probe.status < 400));
        channels[spec.key] = {
          status: worksAnonymously ? "public" : probe.reachable ? "needs-key" : "down",
          detail: worksAnonymously
            ? `Public access works (HTTP ${probe.status}): ${spec.collects}. ${spec.credential} is optional and adds depth.`
            : probe.reachable
              ? `Endpoint answers but refuses anonymous reads (HTTP ${probe.status}). Set ${spec.credential} to collect ${spec.collects}.`
              : `Endpoint unreachable from this server (${probe.error}).`,
        };
        return;
      }

      const probe = await probeEndpoint(spec);
      if (!probe.reachable) {
        channels[spec.key] = {
          status: "down",
          detail: `Unreachable from this server: ${probe.error}.`,
        };
      } else if (probe.status >= 500 || probe.status === 404) {
        channels[spec.key] = {
          status: "down",
          detail: `Endpoint responded HTTP ${probe.status}; this collector needs attention.`,
        };
      } else {
        channels[spec.key] = {
          status: spec.credential ? "configured" : "public",
          detail: `HTTP ${probe.status} from ${new URL(spec.endpoint!).host}. Collects ${spec.collects}.`,
        };
      }
    })
  );

  const values = Object.values(channels);
  const payload = {
    grounding,
    ai,
    search: { ...search, enabled: search.configured },
    egress,
    database: dbStatus(),
    checkedAt: new Date().toISOString(),
    channels,
    summary: {
      total: values.length,
      reachable: values.filter((v) => v.status === "public" || v.status === "configured").length,
      searchOnly: values.filter((v) => v.status === "grounding").length,
      needsKey: values.filter((v) => v.status === "needs-key").length,
      closed: values.filter((v) => v.status === "closed").length,
      planned: values.filter((v) => v.status === "planned").length,
      down: values.filter((v) => v.status === "down").length,
      unverified: values.filter((v) => v.status === "unverified").length,
    },
  };

  healthCache = { at: Date.now(), payload };
  logger.info(
    egress
      ? `[Health] ${payload.summary.total} networks checked: ${payload.summary.reachable} reachable, ${payload.summary.needsKey} need a key, ${payload.summary.planned} not built, ${payload.summary.closed} closed, ${payload.summary.down} down.`
      : `[Health] No outbound internet from this host; ${payload.summary.total} networks marked unverified instead of "down".`
  );
  return payload;
}

// ==========================================
// API ROUTES
// ==========================================

// 0a. Which collection sources are actually configured, so the UI can explain
// an empty dashboard instead of guessing.
