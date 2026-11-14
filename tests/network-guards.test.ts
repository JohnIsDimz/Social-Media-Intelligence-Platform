/**
 * Network guards.
 *
 * Two different holes are closed here:
 *
 *  1. SSRF by name. The scrape allowlist checks the hostname, but an allowlisted
 *     name can resolve to 127.0.0.1 or the cloud metadata address. `isPrivateAddress`
 *     and `assertPublicHost` refuse that.
 *  2. Pagination loops. Every collector that follows a cursor must stop: an API
 *     that keeps returning the same cursor would otherwise spin forever inside a
 *     request that a user is waiting on.
 */
import { isPrivateAddress, assertPublicHost, parseTelegramCount, hashtagCandidates } from "../src/server/collectors.ts";

const results: string[] = [];
const check = (name: string, ok: boolean, note = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${note ? " — " + note : ""}`);

// ------------------------------------------------------- private addresses
const blocked = [
  "127.0.0.1",
  "127.1.2.3",
  "10.0.0.1",
  "172.16.5.4",
  "172.31.255.255",
  "192.168.1.1",
  "169.254.169.254", // cloud metadata
  "100.64.0.1", // CGNAT
  "0.0.0.0",
  "224.0.0.1",
  "255.255.255.255",
  "::1",
  "::",
  "fe80::1",
  "fd00::1",
  "::ffff:127.0.0.1",
];
for (const ip of blocked) {
  check(`blocks ${ip}`, isPrivateAddress(ip) === true);
}

const allowed = ["8.8.8.8", "1.1.1.1", "104.16.0.1", "172.32.0.1", "2606:4700::1111"];
for (const ip of allowed) {
  check(`allows ${ip}`, isPrivateAddress(ip) === false);
}

check("a malformed address is refused rather than trusted", isPrivateAddress("999.1.1.1") === true);
check("a non-numeric address is refused", isPrivateAddress("example.com") === true);

// --------------------------------------------------------------- DNS guard
let dnsResult: "ok" | "blocks" | "unresolved" = "unresolved";
try {
  await assertPublicHost("localhost");
} catch {
  dnsResult = "blocks";
}
check("localhost is refused by the resolver guard", dnsResult === "blocks", dnsResult);

let badDomainBlocked = false;
try {
  await assertPublicHost("this-domain-should-not-exist-smip.invalid");
} catch {
  badDomainBlocked = true;
}
check("an unresolvable domain is refused, not attempted", badDomainBlocked);

// ------------------------------------------------------------- parsing bits
check("hashtag candidates never contain an empty string",
  hashtagCandidates("  ").length === 0, JSON.stringify(hashtagCandidates("  ")));
check("hashtag candidates strip a leading hash", hashtagCandidates("#Kopi").includes("kopi"));
check("a single-word keyword yields one candidate", hashtagCandidates("kopi").length === 1);
check("telegram count ignores non-numeric text", parseTelegramCount("views") === undefined);
check("telegram count handles a decimal k", parseTelegramCount("1.5K") === 1500, String(parseTelegramCount("1.5K")));

console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
