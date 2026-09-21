export const MIRROR_PREVIEW_CSP = [
  "default-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:",
  "style-src 'self' 'unsafe-inline' blob: https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss: data: blob:",
  "worker-src 'self' blob: https:",
  "child-src 'self' blob:",
  "frame-src 'self' blob: https:",
  "manifest-src 'self' https:",
  "object-src 'self' data: blob:",
  "base-uri 'self'",
  "form-action 'self' https:",
].join("; ");

export default MIRROR_PREVIEW_CSP;
