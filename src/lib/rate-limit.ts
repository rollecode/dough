// ponytail: process-local sliding window; one Node process serves Dough, so a shared store is not needed yet.
const PRUNE_AT = 1000;

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  const recent = (key: string) => (hits.get(key) || []).filter((t) => Date.now() - t < windowMs);

  return {
    isLimited(key: string): boolean {
      const list = recent(key);
      hits.set(key, list);
      return list.length >= max;
    },
    record(key: string): void {
      hits.set(key, [...recent(key), Date.now()]);
      if (hits.size <= PRUNE_AT) {
        return;
      }
      for (const k of hits.keys()) {
        if (recent(k).length === 0) {
          hits.delete(k);
        }
      }
    },
    reset(key: string): void {
      hits.delete(key);
    },
  };
}
