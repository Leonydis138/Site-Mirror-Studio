export type GameServiceName =
  | "auth"
  | "session"
  | "leaderboard"
  | "save"
  | "config"
  | "status"
  | "matchmaking"
  | "chat"
  | "store"
  | "inventory"
  | "progress";

export const GAME_SERVICE_NAMES: readonly GameServiceName[] = [
  "auth",
  "session",
  "leaderboard",
  "save",
  "config",
  "status",
  "matchmaking",
  "chat",
  "store",
  "inventory",
  "progress",
];

export function normalizeGameServiceName(value: string): GameServiceName | null {
  const key = value.trim().toLowerCase();
  const aliases: Record<string, GameServiceName> = {
    login: "auth",
    logout: "auth",
    score: "leaderboard",
    scores: "leaderboard",
    highscores: "leaderboard",
    saves: "save",
    settings: "config",
    health: "status",
    match: "matchmaking",
    matches: "matchmaking",
    messages: "chat",
    shop: "store",
    inventory: "inventory",
    items: "inventory",
    profile: "progress",
    progress: "progress",
  };

  return GAME_SERVICE_NAMES.includes(key as GameServiceName)
    ? (key as GameServiceName)
    : aliases[key] ?? null;
}

export function gameServicePayload(service: GameServiceName, jobId: string): Record<string, unknown> {
  const now = new Date().toISOString();
  const base = { ok: true, mirrorJobId: jobId, servedAt: now };

  switch (service) {
    case "auth":
      return {
        ...base,
        user: { id: `mirror-user-${jobId.slice(0, 8)}`, name: "Site Mirror Player", guest: true, roles: ["player"] },
        token: `site-mirror-${jobId}`,
        expiresIn: 86400,
      };
    case "session":
      return {
        ...base,
        sessionId: `session-${jobId}`,
        authenticated: true,
        user: { id: `mirror-user-${jobId.slice(0, 8)}`, name: "Site Mirror Player" },
      };
    case "leaderboard":
      return {
        ...base,
        entries: [
          { rank: 1, user: "Site Mirror", score: 17000 },
          { rank: 2, user: "Local Test", score: 12000 },
          { rank: 3, user: "Guest", score: 8500 },
        ],
      };
    case "save":
      return {
        ...base,
        saved: true,
        saveData: {
          progress: 0,
          unlockedLevels: [],
          settings: { sound: true, music: true, difficulty: "normal" },
          achievements: [],
        },
      };
    case "config":
      return {
        ...base,
        config: {
          version: "mirror-preview",
          enableAudio: true,
          enableMotion: true,
          inputMode: "keyboard",
          locale: "en-US",
          network: "local-preview",
          isPreview: true,
        },
      };
    case "status":
      return {
        ...base,
        status: "online",
        ready: true,
        services: GAME_SERVICE_NAMES,
      };
    case "matchmaking":
      return {
        ...base,
        match: {
          id: `mirror-match-${jobId.slice(0, 8)}`,
          status: "ready",
          players: 1,
          region: "local",
        },
      };
    case "chat":
      return {
        ...base,
        messages: [
          { user: "system", text: "Mirror preview chat is available locally for gameplay testing.", at: now },
        ],
      };
    case "store":
      return {
        ...base,
        items: [
          { id: "starter-pack", name: "Starter Pack", price: 0, currency: "coins" },
          { id: "sound-pack", name: "Sound Pack", price: 500, currency: "coins" },
        ],
      };
    case "inventory":
      return {
        ...base,
        inventory: {
          coins: 250,
          gems: 12,
          items: [{ id: "starter-gun", name: "Starter Gun", quantity: 1 }],
        },
      };
    case "progress":
      return {
        ...base,
        profile: {
          name: "Site Mirror Player",
          level: 1,
          xp: 0,
          achievements: [],
          unlocked: { levels: [], skins: [] },
        },
      };
  }
}

export function buildGameRuntimeScript(jobId: string): string {
  const serviceMap = Object.fromEntries(
    GAME_SERVICE_NAMES.map((name) => [name, gameServicePayload(name, jobId)]),
  );

  return `
    (() => {
      const jobId = ${JSON.stringify(jobId)};
      const serviceMap = ${JSON.stringify(serviceMap)};
      const apiBase = '/api/mirror-jobs/' + encodeURIComponent(jobId) + '/preview/services';

      const makeJsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });

      const getServiceName = (input) => {
        const href = typeof input === 'string' ? input : input?.url ?? '';
        try {
          const parsed = new URL(href, window.location.href);
          const segments = parsed.pathname.split('/').filter(Boolean);
          return segments.at(-1) || null;
        } catch {
          return null;
        }
      };

      const isPreviewGate = (input) => {
        const href = typeof input === 'string' ? input : input?.url ?? '';
        if (!href) return false;
        try {
          const parsed = new URL(href, window.location.href);
          return parsed.origin === window.location.origin && parsed.pathname.includes('/preview/services');
        } catch {
          return false;
        }
      };

      const originalFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const input = args[0];
        if (isPreviewGate(input)) {
          const serviceName = getServiceName(input);
          if (serviceName && serviceMap[serviceName]) {
            return makeJsonResponse(serviceMap[serviceName]);
          }
          return makeJsonResponse({ ok: true, service: 'runtime', jobId, servedAt: new Date().toISOString() });
        }
        return originalFetch(...args);
      };

      const openOriginal = XMLHttpRequest.prototype.open;
      const sendOriginal = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__siteMirrorService = getServiceName(url);
        return openOriginal.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function(body) {
        const serviceName = this.__siteMirrorService;
        if (serviceName && serviceMap[serviceName]) {
          const payload = serviceMap[serviceName];
          Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(this, 'status', { value: 200, configurable: true });
          Object.defineProperty(this, 'statusText', { value: 'OK', configurable: true });
          Object.defineProperty(this, 'responseText', { value: JSON.stringify(payload), configurable: true });
          Object.defineProperty(this, 'response', { value: JSON.stringify(payload), configurable: true });
          this.onreadystatechange?.({ target: this });
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
          return;
        }
        return sendOriginal.call(this, body);
      };

      const storageFactory = () => {
        const store = new Map();
        return {
          getItem(key) { return store.has(String(key)) ? String(store.get(String(key))) : null; },
          setItem(key, value) { store.set(String(key), String(value)); },
          removeItem(key) { store.delete(String(key)); },
          clear() { store.clear(); },
          key(index) { return Array.from(store.keys())[Number(index)] ?? null; },
          get length() { return store.size; },
        };
      };

      try {
        if (!window.localStorage) {
          Object.defineProperty(window, 'localStorage', { value: storageFactory(), configurable: true });
        }
        if (!window.sessionStorage) {
          Object.defineProperty(window, 'sessionStorage', { value: storageFactory(), configurable: true });
        }
      } catch (_error) {
        // Some games implement storage access in unusual ways. Leave the environment functional without crashing.
      }

      if (!('getGamepads' in navigator)) {
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
      }
      if (!navigator.vibrate) {
        navigator.vibrate = () => true;
      }
      if (!('AudioContext' in window) && 'webkitAudioContext' in window) {
        window.AudioContext = window.webkitAudioContext;
      }

      try {
        const OriginalWebSocket = window.WebSocket;
        window.WebSocket = class extends OriginalWebSocket {
          constructor(url, protocols) {
            super(url, protocols);
            setTimeout(() => {
              this.dispatchEvent(new MessageEvent('open', { data: 'mirror-preview-ready' }));
              this.dispatchEvent(new MessageEvent('message', {
                data: JSON.stringify({ ok: true, type: 'connected', service: 'preview', jobId }),
              }));
            }, 0);
          }
        };
      } catch (_error) {
        // Some games gracefully fall back when WebSocket is unavailable.
      }

      window.__siteMirrorPreviewRuntime = {
        ok: true,
        jobId,
        apiBase,
        services: Object.keys(serviceMap),
      };
    })();
  `;
}

export function injectGameRuntimeIntoHtml(html: string, jobId: string): string {
  const script = `<script data-site-mirror-runtime="true" data-mirror-job-id="${jobId}">${buildGameRuntimeScript(jobId)}</script>`;
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, `${script}\n</head>`);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${script}\n</body>`);
  return `${html}\n${script}`;
}

export default GAME_SERVICE_NAMES;

