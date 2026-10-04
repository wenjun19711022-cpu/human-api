/** Small deterministic PRNG so seeded data is identical on every first load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const rng = mulberry32(Date.now() & 0xffffffff);

export function pick<T>(arr: readonly T[], r: () => number = rng): T {
  return arr[Math.floor(r() * arr.length)];
}

export function between(min: number, max: number, r: () => number = rng) {
  return min + (max - min) * r();
}

/** Deterministic fake 32-byte hex for demo document hashes. */
export function fakeHash(seed: string): string {
  const r = mulberry32(hashString(seed));
  let out = "0x";
  for (let i = 0; i < 64; i++) out += Math.floor(r() * 16).toString(16);
  return out;
}

/** Real SHA-256 of an uploaded file, as 0x-prefixed hex. */
export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return "0x" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return fakeHash(String(bytes.length) + String(bytes[0]) + String(Date.now()));
  }
}
