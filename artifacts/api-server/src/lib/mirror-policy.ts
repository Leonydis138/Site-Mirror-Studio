import { sameOrigin, pathMatchesPrefix } from "./mirror-url";
import type { MirrorJobRecord, MirrorOutcome } from "./mirror-types";
import { isHostnameSafe } from "./mirror-fetch";

export function withinScope(candidate: URL, origin: URL, job: MirrorJobRecord): boolean {
  if (!sameOrigin(candidate, origin)) return false;
  if (!pathMatchesPrefix(candidate.pathname, job.pathPrefix)) return false;
  return !job.excludePaths.some((excluded) => pathMatchesPrefix(candidate.pathname, excluded));
}

export function shouldSaveResource(url: URL): boolean {
  return ["http:", "https:"].includes(url.protocol);
}

export function outcomeKey(kind: MirrorOutcome["kind"], url: string): string {
  return `${kind}:${url}`;
}

// --- robots.txt: Disallow/Allow with '*' wildcards and trailing '$'  ------

export type RobotsRules = {
  rules: Array<{ path: string; allow: boolean }>;
  crawlDelayMs: number | null;
};

export async function loadRobots(origin: URL): Promise<RobotsRules> {
  const rules: Array<{ path: string; allow: boolean }> = [];
  let crawlDelayMs: number | null = null;
  try {
    const response = await fetch(new URL("/robots.txt", origin), {
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!response.ok) return { rules, crawlDelayMs };
    const body = await response.text();
    let applies = false;
    for (const rawLine of body.split(/\r?\n/)) {
      const [rawKey, ...rawValue] = rawLine.split("#")[0].split(":");
      const key = rawKey?.trim().toLowerCase();
      const value = rawValue.join(":").trim();
      if (key === "user-agent") {
        applies = value === "*" || value === "";
        continue;
      }
      if (!applies) continue;
      if (key === "disallow" && value) rules.push({ path: value, allow: false });
      if (key === "allow" && value) rules.push({ path: value, allow: true });
      if (key === "crawl-delay" && value) {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) crawlDelayMs = Math.round(seconds * 1000);
      }
    }
  } catch {
    // A missing or unavailable robots file does not block an authorized crawl.
  }
  return { rules, crawlDelayMs };
}

function ruleToRegex(rulePath: string): RegExp {
  const hasEndAnchor = rulePath.endsWith("$");
  const body = hasEndAnchor ? rulePath.slice(0, -1) : rulePath;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${pattern}${hasEndAnchor ? "$" : ""}`);
}

export function blockedByRobots(url: URL, robots: RobotsRules): boolean {
  if (robots.rules.length === 0) return false;
  const relativePath = url.pathname + url.search;
  let best: { allow: boolean; specificity: number } | null = null;
  for (const rule of robots.rules) {
    if (!rule.path) continue;
    const regex = ruleToRegex(rule.path);
    if (!regex.test(relativePath) && !regex.test(url.pathname)) continue;
    const specificity = rule.path.length;
    if (!best || specificity > best.specificity) best = { allow: rule.allow, specificity };
  }
  return best ? !best.allow : false;
}
