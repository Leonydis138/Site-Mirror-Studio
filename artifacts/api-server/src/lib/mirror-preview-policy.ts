export const MIRROR_PREVIEW_CSP = [
  "default-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https:",
  "style-src 'self' 'unsafe-inline' blob: https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https: wss: ws: data: blob:",
  "worker-src 'self' blob: data: https:",
  "child-src 'self' blob: https:",
  "frame-src 'self' blob: https:",
  "manifest-src 'self' https:",
  "object-src 'self' data: blob:",
  "base-uri 'self'",
  "form-action 'self' https:",
  "sandbox allow-scripts allow-same-origin allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation allow-pointer-lock",
].join("; ");

export default MIRROR_PREVIEW_CSP;
