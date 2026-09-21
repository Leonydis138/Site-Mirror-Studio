import { URL } from "node:url";

const URL_ATTRIBUTES = /\b(href|src|poster|data-src|data|action|formaction|manifest|cite|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SRCSET_ATTRIBUTE = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const SCRIPT_REFERENCE = /(?:import\s*\(|(?:import|export)\s+(?:[^;"']+?\s+from\s+)?|fetch\s*\(|new\s+Worker\s*\(|new\s+URL\s*\()\s*["'`]([^"'`]+)["'`]/gi;

function addValue(target: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed && !/^(?:#|mailto:|tel:|javascript:|data:|blob:|about:)/i.test(trimmed)) target.add(trimmed);
}

export function extractMarkupResources(markup: string): { links: string[]; assets: string[] } {
  const links = new Set<string>();
  const assets = new Set<string>();
  const elementPattern = /<([a-z][\w-]*)\b[^>]*>/gi;

  for (const element of markup.matchAll(elementPattern)) {
    const tagName = element[1]?.toLowerCase() ?? "";
    const tag = element[0] ?? "";
    for (const match of tag.matchAll(URL_ATTRIBUTES)) {
      const attribute = match[1]?.toLowerCase();
      const value = match[2] ?? match[3] ?? match[4];
      if (!value) continue;
      const documentReference =
        (tagName === "a" || tagName === "area" || tagName === "iframe" || tagName === "frame") &&
        (attribute === "href" || attribute === "src");
      if (documentReference) addValue(links, value);
      else addValue(assets, value);
    }
    for (const match of tag.matchAll(SRCSET_ATTRIBUTE)) {
      for (const candidate of (match[1] ?? match[2] ?? match[3] ?? "").split(",")) {
        addValue(assets, candidate.trim().split(/\s+/)[0]);
      }
    }
  }

  // CSS in style attributes and inline style blocks is otherwise invisible to
  // an attribute-only crawler. This intentionally extracts URLs only; scope
  // and protocol checks remain enforced by the job runner.
  for (const match of markup.matchAll(CSS_URL)) addValue(assets, match[1] ?? match[2] ?? match[3]);
  for (const match of markup.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const reference of match[1]?.matchAll(SCRIPT_REFERENCE) ?? []) addValue(assets, reference[1]);
  }
  return { links: [...links], assets: [...assets] };
}

export function normalizeResourceValues(values: string[], baseUrl: string): string[] {
  return [...new Set(values)].flatMap((value) => {
    try {
      const parsed = new URL(value, baseUrl);
      parsed.hash = "";
      return [parsed.href];
    } catch {
      return [];
    }
  });
}
