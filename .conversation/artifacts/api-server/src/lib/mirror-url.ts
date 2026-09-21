import { createHash } from "node:crypto";
import path from "node:path";
import { URL } from "node:url";

export function extensionForContentType(contentType: string | null | undefined): string | null {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mimeType) return null;
  const extensions: Record<string, string> = {
    "application/pdf": ".pdf", "application/json": ".json", "application/ld+json": ".json", "application/xml": ".xml",
    "application/xhtml+xml": ".html", "application/javascript": ".js", "text/javascript": ".js", "application/wasm": ".wasm",
    "application/manifest+json": ".webmanifest", "application/vnd.apple.mpegurl": ".m3u8", "audio/mpegurl": ".m3u8",
    "application/zip": ".zip", "image/avif": ".avif", "image/gif": ".gif", "image/jpeg": ".jpg", "image/png": ".png",
    "image/svg+xml": ".svg", "image/webp": ".webp", "audio/mpeg": ".mp3", "audio/ogg": ".ogg", "audio/wav": ".wav",
    "video/mp4": ".mp4", "video/webm": ".webm", "font/woff": ".woff", "font/woff2": ".woff2", "application/font-woff": ".woff",
    "text/html": ".html", "text/css": ".css", "text/csv": ".csv", "text/plain": ".txt", "text/xml": ".xml",
  };
  return extensions[mimeType] ?? ".bin";
}

export function isHtmlContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && /(?:text\/html|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType));
}
export function looksLikeHtmlDocument(body: Uint8Array): boolean {
  const sample = Buffer.from(body.subarray(0, 8192)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return /^<!doctype\s+html|^<html(?:[\s>])/i.test(sample);
}
export function isHtmlResponse(contentType: string | null | undefined, body: Uint8Array): boolean {
  return isHtmlContentType(contentType) || ((!contentType || /application\/octet-stream/i.test(contentType)) && looksLikeHtmlDocument(body));
}
export function filePathForUrl(rawUrl: string, contentType?: string | null): string {
  const parsed = new URL(rawUrl);
  const cleanPath = decodeURIComponent(parsed.pathname).replace(/\\/g, "/");
  const safeSegments = cleanPath.split("/").filter(Boolean).map((segment) => segment.replace(/[^a-zA-Z0-9._~-]/g, "_"));
  const querySuffix = parsed.search ? `~${createHash("sha1").update(parsed.search).digest("hex").slice(0, 8)}` : "";
  const extension = extensionForContentType(contentType);
  const last = safeSegments.at(-1) ?? "";
  if (!path.extname(last)) safeSegments.push(`index${querySuffix}${extension ?? ".html"}`);
  else if (querySuffix) {
    const ext = path.extname(last);
    safeSegments[safeSegments.length - 1] = `${last.slice(0, -ext.length)}${querySuffix}${ext}`;
  }
  if (safeSegments.length === 0) safeSegments.push(`index${querySuffix}${extension ?? ".html"}`);
  return path.join(parsed.hostname, ...safeSegments);
}
export function sameOrigin(candidate: URL, origin: URL): boolean { return candidate.origin === origin.origin; }
export function normalizePathPrefix(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  return !normalized || normalized === "/" ? "/" : `/${normalized.replace(/^\/+|\/+$/g, "")}`;
}
export function pathMatchesPrefix(candidatePath: string, prefix: string): boolean { return prefix === "/" || candidatePath === prefix || candidatePath.startsWith(`${prefix}/`); }
