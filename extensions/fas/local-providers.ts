/**
 * Local-provider discovery (Phase 2D) — discovery-first, no assumptions.
 *
 * Pure module with injectable fetch (tests never touch the network).
 * Probes well-known loopback endpoints, parses per-dialect model lists into
 * registry-shape candidates, and validates them WITHOUT assuming quality,
 * context size, or reasoning ability (quality is always "unknown" until a
 * live verification turn proves otherwise — that turn requires a real daemon
 * and is explicitly out of scope here).
 *
 * Registry admission itself is Pi-core territory (not modified); this module
 * is the discovery/validation half. Never hardcodes phantom "ollama/*" models:
 * candidates exist only when an endpoint actually answers.
 */

export interface LocalEndpoint {
  name: "ollama" | "lmstudio" | "lm-studio";
  url: string;
}

export interface LocalCandidate {
  provider: string;
  id: string;
  local: true;
  quality: "unknown";
  contextWindow?: number;
  reasoning?: boolean;
}

export const KNOWN_LOCAL_ENDPOINTS: LocalEndpoint[] = [
  { name: "ollama", url: "http://127.0.0.1:11434/api/tags" },
  { name: "lmstudio", url: "http://127.0.0.1:1234/v1/models" },
];

export interface ProbeOptions {
  fetchFn?: (url: string, init?: Record<string, unknown>) => Promise<{
    ok: boolean;
    status?: number;
    json: () => Promise<unknown>;
  }>;
  endpoints?: LocalEndpoint[];
  timeoutMs?: number;
}

type FetchFn = NonNullable<ProbeOptions["fetchFn"]>;

function defaultFetch(url: string, init?: Record<string, unknown>): ReturnType<FetchFn> {
  return (globalThis.fetch as unknown as FetchFn)(url, init);
}

async function getJson(
  fetchFn: FetchFn,
  url: string,
  timeoutMs: number,
): Promise<unknown | undefined> {
  const ctrl =
    typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timer = ctrl
    ? setTimeout(() => {
        try {
          ctrl.abort();
        } catch {
          /* ignore */
        }
      }, timeoutMs)
    : undefined;
  try {
    const res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res || res.ok !== true) return undefined;
    return await res.json();
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseDialect(endpoint: LocalEndpoint, payload: unknown): LocalCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const rec = payload as Record<string, unknown>;
  if (endpoint.name === "ollama" && Array.isArray(rec.models)) {
    const out: LocalCandidate[] = [];
    for (const m of rec.models) {
      const name = (m as Record<string, unknown> | null)?.name;
      if (typeof name === "string" && name.trim()) {
        out.push({ provider: "ollama", id: name.trim(), local: true as const, quality: "unknown" as const });
      }
    }
    return out;
  }
  if (endpoint.name === "lmstudio" && Array.isArray(rec.data)) {
    const out: LocalCandidate[] = [];
    for (const m of rec.data) {
      const id = (m as Record<string, unknown> | null)?.id;
      if (typeof id === "string" && id.trim()) {
        out.push({ provider: "lmstudio", id: id.trim(), local: true as const, quality: "unknown" as const });
      }
    }
    return out;
  }
  return [];
}

/** Probe endpoints sequentially. Never throws; unreachable/malformed → skipped. */
export async function probeLocalProviders(
  opts: ProbeOptions = {},
): Promise<LocalCandidate[]> {
  const fetchFn = opts.fetchFn ?? defaultFetch;
  const endpoints = Array.isArray(opts.endpoints) ? opts.endpoints : KNOWN_LOCAL_ENDPOINTS;
  const timeoutMs =
    typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : 1500;
  const out: LocalCandidate[] = [];
  for (const ep of endpoints) {
    const dialect = ep?.name === "lm-studio" ? "lmstudio" : ep?.name;
    if (!ep || (dialect !== "ollama" && dialect !== "lmstudio") || typeof ep.url !== "string") {
      continue;
    }
    try {
      const payload = await getJson(fetchFn, ep.url, timeoutMs);
      if (payload === undefined) continue;
      out.push(...parseDialect({ name: dialect, url: ep.url }, payload));
    } catch {
      continue;
    }
  }
  return out;
}

export interface LocalValidation {
  valid: boolean;
  quality: "unknown";
  errors: string[];
}

/** Capability validation: shape only. Quality is never inferred. Never throws. */
export function validateLocalCandidate(candidate: unknown): LocalValidation {
  try {
    const rec = (candidate ?? {}) as Record<string, unknown>;
    const errors: string[] = [];
    if (rec.provider !== "ollama" && rec.provider !== "lmstudio") {
      errors.push(`unknown local provider: ${String(rec.provider)}`);
    }
    if (typeof rec.id !== "string" || !rec.id.trim()) {
      errors.push("id must be a non-empty string");
    }
    return { valid: errors.length === 0, quality: "unknown", errors };
  } catch {
    return { valid: false, quality: "unknown", errors: ["unreadable candidate"] };
  }
}
