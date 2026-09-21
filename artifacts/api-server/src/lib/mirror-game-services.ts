export type GameServiceName = "auth" | "session" | "leaderboard" | "save" | "config" | "status" | "matchmaking" | "chat" | "store";

export const GAME_SERVICE_NAMES: readonly GameServiceName[] = ["auth", "session", "leaderboard", "save", "config", "status", "matchmaking", "chat", "store"];

export function normalizeGameServiceName(value: string): GameServiceName | null {
  const aliases: Record<string, GameServiceName> = { login: "auth", logout: "auth", score: "leaderboard", saves: "save", settings: "config", health: "status", match: "matchmaking", messages: "chat", shop: "store" };
  const key = value.trim().toLowerCase();
  return GAME_SERVICE_NAMES.includes(key as GameServiceName) ? key as GameServiceName : aliases[key] ?? null;
}

export function gameServicePayload(service: GameServiceName, jobId: string): Record<string, unknown> {
  const base = { ok: true, mirrorJobId: jobId, servedAt: new Date().toISOString() };
  switch (service) {
    case "auth": return { ...base, user: { id: `mirror-user-${jobId.slice(0, 8)}`, name: "Site Mirror Player", guest: true }, token: `site-mirror-${jobId}` };
    case "session": return { ...base, sessionId: `session-${jobId}`, authenticated: true };
    case "leaderboard": return { ...base, entries: [{ rank: 1, user: "Site Mirror", score: 17000 }, { rank: 2, user: "Guest", score: 8500 }] };
    case "save": return { ...base, saved: true, saveData: { progress: 0, unlockedLevels: [], settings: { sound: true, music: true, difficulty: "normal" } } };
    case "config": return { ...base, config: { version: "mirror-preview", enableAudio: true, enableMotion: true, inputMode: "keyboard", locale: "en-US", network: "local-preview" } };
    case "status": return { ...base, status: "online", ready: true, services: GAME_SERVICE_NAMES };
    case "matchmaking": return { ...base, match: { id: `mirror-match-${jobId.slice(0, 8)}`, status: "ready", players: 1, region: "local" } };
    case "chat": return { ...base, messages: [{ user: "system", text: "Mirror preview chat is available locally.", at: base.servedAt }] };
    case "store": return { ...base, items: [{ id: "starter-pack", name: "Starter Pack", price: 0, currency: "coins" }] };
  }
}

export function buildGameRuntimeScript(jobId: string): string {
  const services = JSON.stringify(Object.fromEntries(GAME_SERVICE_NAMES.map((name) => [name, gameServicePayload(name, jobId)])));
  return `(() => {
    const jobId = ${JSON.stringify(jobId)};
    const services = ${services};
    const servicePath = (url) => { try { return new URL(url, location.href).pathname.split('/').filter(Boolean).at(-1); } catch { return null; } };
    const local = (input) => { const name = servicePath(typeof input === 'string' ? input : input?.url); return name && services[name] ? new Response(JSON.stringify(services[name]), {status: 200, headers: {'Content-Type': 'application/json'}}) : null; };
    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (...args) => local(args[0]) ?? fetchOriginal(...args);
    const openOriginal = XMLHttpRequest.prototype.open;
    const sendOriginal = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) { this.__mirrorService = servicePath(url); return openOriginal.call(this, method, url, ...rest); };
    XMLHttpRequest.prototype.send = function(body) { const payload = this.__mirrorService && services[this.__mirrorService]; if (!payload) return sendOriginal.call(this, body); Object.defineProperty(this, 'readyState', {value: 4}); Object.defineProperty(this, 'status', {value: 200}); Object.defineProperty(this, 'responseText', {value: JSON.stringify(payload)}); this.onreadystatechange?.({target: this}); this.onload?.({target: this}); };
    window.__siteMirrorPreviewRuntime = {ok: true, jobId, apiBase: '/api/mirror-jobs/' + encodeURIComponent(jobId) + '/preview/services', services: Object.keys(services)};
  })();`;
}

export function injectGameRuntimeIntoHtml(html: string, jobId: string): string {
  const script = `<script data-site-mirror-runtime="true">${buildGameRuntimeScript(jobId)}</script>`;
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, `${script}\n</head>`);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${script}\n</body>`);
  return `${html}\n${script}`;
}
