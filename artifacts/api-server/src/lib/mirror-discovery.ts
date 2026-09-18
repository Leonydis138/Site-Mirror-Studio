import { URL } from "node:url";

export function extractMarkupResources(markup: string): { links: string[]; assets: string[] } {
  const links = new Set<string>();
  const assets = new Set<string>();
  const elementPattern = /<([a-z][\w-]*)\b[^>]*>/gi;
  const attributePattern = /\b(href|src|poster|data-src|data)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const element of markup.matchAll(elementPattern)) {
    const tagName = element[1]?.toLowerCase();
    const tag = element[0] ?? "";
    for (const match of tag.matchAll(attributePattern)) {
      const attribute = match[1]?.toLowerCase();
      const value = match[2] ?? match[3];
      if (!value) continue;
      const isDocument =
        (tagName === "a" || tagName === "area" || tagName === "iframe") &&
        (attribute === "href" || attribute === "src");
      if (isDocument) links.add(value);
      else assets.add(value);
    }
  }

  const srcsetPattern = /\b(?:srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of markup.matchAll(srcsetPattern)) {
    for (const candidate of (match[1] ?? match[2] ?? "").split(",")) {
      const url = candidate.trim().split(/\s+/)[0];
      if (url) assets.add(url);
    }
  }
  return { links: [...links], assets: [...assets] };
}

export function normalizeResourceValues(values: string[], baseUrl: string): string[] {
  return values
    .map((value) => {
      try {
        const parsed = new URL(value, baseUrl);
        parsed.hash = "";
        return parsed.href;
      } catch {
        return null;
      }
    })
    .filter((value): value is string => Boolean(value));
}
