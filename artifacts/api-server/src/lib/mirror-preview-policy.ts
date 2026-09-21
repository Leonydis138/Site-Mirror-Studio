// Game-friendly preview policy
//
// Mirrored content is only previewed from the generated archive. The crawler
// continues to enforce authorized same-origin collection and SSRF checks.
// The preview needs a real origin so localStorage, IndexedDB, workers, module
// scripts, WebGL and audio APIs behave like they do on a normal website.
export const MIRROR_PREVIEW_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'self' data:",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
