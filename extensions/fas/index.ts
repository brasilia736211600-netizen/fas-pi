/**
 * FAS — Token Efficiency Framework + central model supervisor
 *
 * Registers the custom provider `fas-router` with model `auto`. When the user
 * activates it (`/fas-router:on` → `pi.setModel(fas-router/auto)`), FAS — not Pi
 * core, not free-router, not any single provider — owns the final execution
 * candidate decision for each request, with transparent same-request
 * cross-provider fallback inside the provider's `streamSimple`.
 *
 * Evidence provenance: FAS_FEASIBILITY_GATE_REPORT.md
 *  - A/B pi.setModel controls the executing model (run granularity)   PROVEN-CONTROLLABLE
 *  - C   cross-provider retry inside a custom provider streamSimple   PROVEN-CONTROLLABLE
 *  - D   outcome/status observation only                              PROVEN-OBSERVABLE-ONLY
 *
 * Fail-safe: when no eligible candidate exists, FAS delegates to the previously
 * active model (existing Pi behavior). All handlers are exception-guarded so FAS
 * can never break normal operation. No code/config/credential self-modification.
 *
 * Pure logic lives in ./core.ts (shared with the test suite).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, streamSimple } from "@earendil-works/pi-ai";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  FAS_PROVIDER,
  installFas,
  makeStreamCandidate,
  newEvidenceStore,
  parseKnowledge,
  redact,
} from "./core.ts";

const KB_PATH = path.join(process.env.HOME ?? ".", ".pi", "agent", "fas-knowledge.json");
const MAX_RECENT = 100;

function readText(p: string): string | undefined {
  try { return fs.readFileSync(p, "utf8"); } catch { return undefined; }
}

export default function (pi: ExtensionAPI) {
  // ── Persistence: smallest structured local knowledge file ──
  const raw = readText(KB_PATH);
  let store: any = raw ? parseKnowledge(raw) : newEvidenceStore();
  let recent: any[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.recent)) recent = parsed.recent.slice(-MAX_RECENT);
  } catch { recent = []; }

  function save(): void {
    try {
      fs.mkdirSync(path.dirname(KB_PATH), { recursive: true });
      fs.writeFileSync(KB_PATH, JSON.stringify({ version: 1, updatedAt: Date.now(), stats: store.stats, providers: store.providers ?? {}, recent: recent.slice(-MAX_RECENT) }, null, 0));
    } catch { /* persistence must never break routing */ }
  }

  // ── Runtime context capture (streamSimple runs outside event ctx) ──
  let ctxRef: any;
  let previousModel: any;
  const capture = (_e: any, ctx: any) => {
    ctxRef = ctx;
    if (ctx?.model && ctx.model.provider !== FAS_PROVIDER) previousModel = ctx.model;
  };
  for (const ev of ["session_start", "agent_start", "input", "before_agent_start", "model_select", "turn_end"]) {
    pi.on(ev as any, capture as any);
  }

  const safe = (fn: () => any): any => { try { return fn(); } catch { return undefined; } };

  const deps = {
    getCandidates: () => safe(() => ctxRef?.modelRegistry?.getAll()) ?? [],
    getAvailable: () => safe(() => ctxRef?.modelRegistry?.getAvailable()),
    getAuth: async (model: any) => {
      const r = safe(() => ctxRef?.modelRegistry?.getApiKeyAndHeaders(model));
      if (!r) return { ok: false, error: "model registry unavailable" };
      return await r;
    },
    // Execute the selected candidate through a provider-aware dispatch:
    // prefer the registry's own streamSimple (resolves auth and executes
    // extension-registered custom providers by api id — e.g. free-router/auto);
    // fall back to the pi-ai compat dispatch when the registry is unavailable.
    streamCandidate: makeStreamCandidate(
      { getRegistry: () => safe(() => ctxRef?.modelRegistry) },
      (model: any, context: any, options: any) => streamSimple(model, context, options),
    ),
    createEventStream: () => createAssistantMessageEventStream(),
    fallbackModel: () => previousModel,
    findModel: (provider: string, id: string) => safe(() => ctxRef?.modelRegistry?.find(provider, id)),
    getCurrentModel: () => ctxRef?.model,
    now: () => Date.now(),
    log: (entry: any) => {
      try { recent.push(redact(entry)); if (recent.length > MAX_RECENT) recent.shift(); save(); } catch { /* ignore */ }
    },
    loadKnowledge: () => store,
    saveKnowledge: (next: any) => { store = next; save(); },
    maxAttempts: 3,
  };

  installFas(pi, deps as any);
}