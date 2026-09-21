import { promises as fs } from "node:fs";
import path from "node:path";
import type { MirrorJobRecord, MirrorOutcome } from "./mirror-types";
import { outcomeKey } from "./mirror-policy";
import { filePathForUrl, isHtmlContentType } from "./mirror-url";

export const REWRITABLE_ATTR = /\b(href|src|poster|data-src|data|action|formaction|manifest|cite|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
export const SRCSET_ATTR = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
export const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
export const JS_LOCAL_REFERENCE = /(["'`])((?:\.\.?\/|\/)[^"'`]+)\1/g;

export function savedOutcomeForUrl(job: MirrorJobRecord, rawUrl: string): MirrorOutcome | undefined {
  let candidate = rawUrl;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const outcome = job.outcomes.get(outcomeKey("page", candidate)) ?? job.outcomes.get(outcomeKey("asset", candidate));
    if (outcome?.status === "saved" && outcome.archivePath) return outcome;
    const redirected = job.redirects.get(candidate);
    if (!redirected || redirected === candidate) break;
    candidate = redirected;
  }
  return undefined;
}

export function rewriteReference(rawValue: string, sourceUrl: string, sourceFile: string, job: MirrorJobRecord): string {
  if (!rawValue || /^\s*(#|mailto:|tel:|javascript:|data:|blob:|about:|https?:\/\/[^/]+\/\/)/i.test(rawValue)) return rawValue;
  let target: URL;
  try { target = new URL(rawValue, sourceUrl); } catch { return rawValue; }
  if (!["http:", "https:"].includes(target.protocol)) return rawValue;
  const hash = target.hash;
  target.hash = "";
  const targetOutcome = savedOutcomeForUrl(job, target.href);
  if (!targetOutcome?.archivePath) return rawValue;
  const targetFile = path.join(job.outputDir, targetOutcome.archivePath);
  const relative = path.relative(path.dirname(sourceFile), targetFile).replace(/\\/g, "/") || path.basename(targetFile);
  return `${relative}${hash}`;
}

export function rewriteMarkupContent(markup: string, sourceUrl: string, sourceFile: string, job: MirrorJobRecord): string {
  let rewritten = markup.replace(REWRITABLE_ATTR, (match, attr: string, dq?: string, sq?: string, bare?: string) => {
    const rawValue = dq ?? sq ?? bare;
    if (rawValue === undefined) return match;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `${attr}=${quote}${rewriteReference(rawValue, sourceUrl, sourceFile, job)}${quote}`;
  });
  rewritten = rewritten.replace(SRCSET_ATTR, (match, dq?: string, sq?: string, bare?: string) => {
    const rawValue = dq ?? sq ?? bare ?? "";
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    const value = rawValue.split(",").map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (parts[0]) parts[0] = rewriteReference(parts[0], sourceUrl, sourceFile, job);
      return parts.join(" ");
    }).join(", ");
    return `srcset=${quote}${value}${quote}`;
  });
  return rewritten;
}

export function rewriteCssContent(css: string, sourceUrl: string, sourceFile: string, job: MirrorJobRecord): string {
  return css.replace(CSS_URL, (match, dq?: string, sq?: string, bare?: string) => {
    const rawValue = (dq ?? sq ?? bare ?? "").trim();
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `url(${quote}${rewriteReference(rawValue, sourceUrl, sourceFile, job)}${quote})`;
  });
}

export function rewriteScriptContent(script: string, sourceUrl: string, sourceFile: string, job: MirrorJobRecord): string {
  return script.replace(JS_LOCAL_REFERENCE, (match, quote: string, rawValue: string) => `${quote}${rewriteReference(rawValue, sourceUrl, sourceFile, job)}${quote}`);
}

export async function rewriteSavedFile(job: MirrorJobRecord, sourceUrl: string, kind: MirrorOutcome["kind"]): Promise<void> {
  const outcome = job.outcomes.get(outcomeKey(kind, sourceUrl));
  if (outcome?.status !== "saved" || !outcome.archivePath) return;
  const sourceFile = path.join(job.outputDir, outcome.archivePath);
  let body: string;
  try { body = await fs.readFile(sourceFile, "utf8"); } catch { return; }
  const contentType = outcome.contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const rewritten = isHtmlContentType(outcome.contentType) || /\.html?$/i.test(sourceFile)
    ? rewriteMarkupContent(body, sourceUrl, sourceFile, job)
    : contentType === "text/css" || /\.css$/i.test(sourceFile)
      ? rewriteCssContent(body, sourceUrl, sourceFile, job)
      : contentType.includes("javascript") || /\.(?:js|mjs|cjs)$/i.test(sourceFile)
        ? rewriteScriptContent(body, sourceUrl, sourceFile, job)
        : body;
  if (rewritten !== body) await fs.writeFile(sourceFile, rewritten);
}
