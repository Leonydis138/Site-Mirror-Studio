import { lookup } from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";

const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const dnsSafetyCache = new Map<string, { safe: boolean; expiresAt: number }>();

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return true;
}

export async function isHostnameSafe(hostname: string): Promise<boolean> {
  const key = hostname.toLowerCase();
  const cached = dnsSafetyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.safe;

  let safe: boolean;
  if (net.isIP(key)) {
    safe = !isPrivateAddress(key);
  } else if (key === "localhost" || key.endsWith(".localhost") || key.endsWith(".local")) {
    safe = false;
  } else {
    try {
      const addresses = await lookup(key, { all: true });
      safe = addresses.length > 0 && !addresses.some(({ address }) => isPrivateAddress(address));
    } catch {
      safe = false;
    }
  }

  dnsSafetyCache.set(key, { safe, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
  return safe;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid website URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials are not supported.");
  }

  const safe = await isHostnameSafe(parsed.hostname);
  if (!safe) {
    throw new Error("The website resolves to a local or private network address, or could not be resolved.");
  }

  parsed.hash = "";
  return parsed;
}
