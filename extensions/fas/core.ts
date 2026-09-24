/**
 * FAS Router — core (pure, dependency-free, testable)
 *
 * Central supervisor for the `fas-router/auto` custom provider.
 * All logic here is pure/injected so it can run under plain Node for tests.
 * Runtime wiring (pi-ai streaming, registry, fs persistence) lives in index.ts.
 *
 * Evidence basis (FAS_FEASIBILITY_GATE_REPORT.md):
 *  - A/B: pi.setModel controls the executing model (run granularity)      → PROVEN-CONTROLLABLE
 *  - C:   cross-provider retry inside a custom provider streamSimple      → PROVEN-CONTROLLABLE
 *  - D:   outcome/status observation (after_provider_response, turn_end)   → PROVEN-OBSERVABLE-ONLY
 */

export const FAS_PROVIDER = "fas-router";
export const FAS_MODEL_ID = "auto";
export const DEFAULT_MAX_ATTEMPTS = 3;
export const SHORTLIST_SIZE = 5;
export const SHORTLIST_MIN = 3;
export const VERIFIED_FAILURE_THRESHOLD = 3;
export const MAX_KNOWLEDGE_RECORDS = 200;
export const DEFAULT_MAX_ROUNDS = 4;
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
/** Router advertises reasoning so Pi does not clamp thinking before FAS decides. */
export const FAS_THINKING_MAP = { off: "off", minimal: "minimal", low: "low", medium: "medium", high: "high" };

const SECRET_KEY = /(api[_-]?key|authorization|token|secret|password|bearer|credential)/i;

// Phase 2F: credential-shaped VALUES are redacted even under neutral keys.
// Minimal well-known prefixes only (OpenRouter/Anthropic/GitHub/OpenAI/Slack).
const SECRET_VALUE = /\b(sk-or-v1-[A-Za-z0-9]{8,}|sk-ant-[A-Za-z0-9\-_]{8,}|sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[bap]-[A-Za-z0-9\-]+)\b/;

/**
 * Deep-redact credential-shaped values. Never log raw auth material.
 * Numeric/boolean values under credential-shaped keys are TELEMETRY (e.g.
 * `tokens: 123` token counts), never credentials — they pass through so
 * token accounting survives. Strings and containers are redacted/deep-scanned.
 */
export function redact(value) {
  if (typeof value === "string") return SECRET_VALUE.test(value) ? "[REDACTED]" : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const numericTelemetry = typeof v === "number" || typeof v === "boolean";
      out[k] = SECRET_KEY.test(k) && !numericTelemetry ? "[REDACTED]" : redact(v);
    }
    return out;
  }
  return value;
}

export function modelKey(m) { return m ? `${m.provider}/${m.id}` : ""; }
export function failureKey(provider, id) { return `${provider}/${id}`; }

// ── Evidence store (bounded, serializable) ──────────────────────────
export const PROVIDER_BREAKER_THRESHOLD = 2;
export const PROVIDER_BREAKER_COOLDOWN_MS = 30 * 60 * 1000;
export function newEvidenceStore() { return { version: 1, updatedAt: 0, stats: {}, providers: {} }; }

export function recordOutcome(store, rec) {
  const stats = { ...store.stats };
  const k = failureKey(rec.provider, rec.id);
  const prev = stats[k] ?? { attempts: 0, successes: 0, failures: 0, consecutiveFailures: 0, avgLatencyMs: 0, tokens: 0 };
  const next = { ...prev, attempts: prev.attempts + 1, lastSeen: rec.at ?? store.updatedAt ?? 0 };
  if (rec.ok) { next.successes = prev.successes + 1; next.consecutiveFailures = 0; }
  else {
    next.failures = prev.failures + 1;
    next.consecutiveFailures = prev.consecutiveFailures + 1;
    next.lastFailureKind = rec.kind;
  }
  if (typeof rec.latencyMs === "number") {
    next.avgLatencyMs = prev.attempts === 0 ? rec.latencyMs : Math.round((prev.avgLatencyMs * prev.attempts + rec.latencyMs) / (prev.attempts + 1));
  }
  if (typeof rec.tokens === "number") next.tokens = prev.tokens + rec.tokens;
  // Router-gap observability: keep the lane's own error text + status so the
  // next turn can tell "no credits" from "network" (bounded: truncated, two fields).
  if (typeof rec.status === "number") next.lastStatus = rec.status;
  if (typeof rec.error === "string" && rec.error) next.lastError = rec.error.slice(0, 200);
  stats[k] = next;
  // Persistent provider rollup for the breaker (lane-independent, tiny cardinality).
  const providers = { ...(store.providers ?? {}) };
  const pp = providers[rec.provider] ?? { consec: 0, lastSeen: 0 };
  providers[rec.provider] = rec.ok
    ? { consec: 0, lastSeen: rec.at ?? store.updatedAt ?? 0, lastKind: pp.lastKind }
    : { consec: (pp.consec ?? 0) + 1, lastSeen: rec.at ?? store.updatedAt ?? 0, lastKind: rec.kind };
  return { ...store, stats: evict(stats), providers, updatedAt: rec.at ?? store.updatedAt };
}

function evict(stats) {
  const keys = Object.keys(stats);
  if (keys.length <= MAX_KNOWLEDGE_RECORDS) return stats;
  keys.sort((a, b) => (stats[a].lastSeen ?? 0) - (stats[b].lastSeen ?? 0) || a.localeCompare(b));
  const trimmed = { ...stats };
  for (const k of keys.slice(0, keys.length - MAX_KNOWLEDGE_RECORDS)) delete trimmed[k];
  return trimmed;
}

export function candidateStats(store, model) { return store.stats[failureKey(model.provider, model.id)]; }
export function verifiedFailure(store, model) {
  const s = candidateStats(store, model);
  return !!s && s.consecutiveFailures >= VERIFIED_FAILURE_THRESHOLD;
}
export function providerInCooldown(store, provider, nowMs) {
  const p = store.providers?.[provider];
  return !!p && (p.consec ?? 0) >= PROVIDER_BREAKER_THRESHOLD
    && typeof p.lastSeen === "number" && nowMs - p.lastSeen < PROVIDER_BREAKER_COOLDOWN_MS;
}
export function shouldSkipCandidate(store, model, nowMs = Date.now()) {
  return verifiedFailure(store, model) || providerInCooldown(store, model.provider, nowMs);
}

export function learningRules(store) {
  const rules = [];
  for (const [key, s] of Object.entries(store.stats)) {
    const i = key.indexOf("/");
    const provider = key.slice(0, i), id = key.slice(i + 1);
    if (s.consecutiveFailures >= VERIFIED_FAILURE_THRESHOLD) {
      rules.push({ type: "avoid", provider, id, reason: `consecutive-failures:${s.consecutiveFailures}${s.lastFailureKind ? ":" + s.lastFailureKind : ""}`, evidenceCount: s.failures });
    } else if (s.successes > 0 && s.failures > 0 && s.consecutiveFailures === 0) {
      rules.push({ type: "recover", provider, id, reason: "recovered-after-failure", evidenceCount: s.successes });
    }
  }
  return rules;
}

export function serializeKnowledge(store) { return JSON.stringify(store); }
export function parseKnowledge(json) {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || typeof parsed.stats !== "object" || parsed.stats === null) return newEvidenceStore();
    const providers = parsed.providers && typeof parsed.providers === "object" ? { ...parsed.providers } : {};
    return { version: 1, updatedAt: parsed.updatedAt ?? 0, stats: evict({ ...parsed.stats }), providers };
  } catch { return newEvidenceStore(); }
}
export function mergeKnowledge(a, b) {
  const stats = { ...a.stats };
  for (const [k, v] of Object.entries(b.stats)) {
    const p = stats[k];
    stats[k] = !p ? v : {
      attempts: p.attempts + v.attempts, successes: p.successes + v.successes, failures: p.failures + v.failures,
      consecutiveFailures: Math.max(p.consecutiveFailures, v.consecutiveFailures),
      avgLatencyMs: Math.round((p.avgLatencyMs + v.avgLatencyMs) / 2), tokens: p.tokens + v.tokens,
      lastFailureKind: v.lastFailureKind ?? p.lastFailureKind, lastSeen: Math.max(p.lastSeen ?? 0, v.lastSeen ?? 0),
    };
  }
  const providers = { ...(a.providers ?? {}) };
  for (const [pr, v] of Object.entries(b.providers ?? {})) {
    const prev = providers[pr];
    providers[pr] = !prev ? v : {
      consec: Math.max(prev.consec ?? 0, v.consec ?? 0),
      lastSeen: Math.max(prev.lastSeen ?? 0, v.lastSeen ?? 0),
      lastKind: (v.lastSeen ?? 0) >= (prev.lastSeen ?? 0) ? v.lastKind : prev.lastKind,
    };
  }
  return { version: 1, updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0), stats: evict(stats), providers };
}

// ── Evidence record (secret-free by construction) ───────────────────
export function buildEvidenceRecord(o) {
  const rec = { provider: o.provider, id: o.id, ok: !!o.ok };
  if (o.kind) rec.kind = o.kind;
  if (typeof o.status === "number") rec.status = o.status;
  if (typeof o.latencyMs === "number") rec.latencyMs = o.latencyMs;
  if (typeof o.tokens === "number") rec.tokens = o.tokens;
  if (o.reason) rec.reason = String(o.reason).slice(0, 200);
  return rec;
}

// ── Failure classification ──────────────────────────────────────────
export function classifyFailure(input) {
  let status = input?.status;
  const msg = String(input?.errorMessage ?? "");
  // Providers often THROW text like "402: {...}" with no status object.
  // A LEADING code+colon is advisory evidence: it upgrades the reason but
  // never hardens retryability — the failure is lane-scoped and the
  // within-turn breaker (not the classifier) decides whether to continue.
  // Bare prose ("401 Unauthorized", no colon) stays conservative.
  let statusFromText = false;
  if (status == null && typeof input?.errorMessage === "string") {
    const m = /^(\d{3})\s*:/.exec(input.errorMessage);
    if (m) { status = Number(m[1]); statusFromText = true; }
  }
  if (input?.verification) return { kind: "verification", retryable: true, fatal: false, reason: "verification" };
  if (status === 401 || status === 403) return { kind: "auth", retryable: statusFromText, fatal: !statusFromText, reason: `auth:${status}` };
  if (status === 402) return { kind: "credits", retryable: statusFromText, fatal: !statusFromText, reason: `credits:${status}` };
  if (status === 429 || /\b429\b|rate.?limit/i.test(msg)) return { kind: "rate_limit", retryable: true, fatal: false, reason: `rate_limit:${status ?? "msg"}` };
  if (status === 408 || status === 504 || status === 524 || /timeout|timed out|ETIMEDOUT|aborted by timeout/i.test(msg)) return { kind: "timeout", retryable: true, fatal: false, reason: `timeout:${status ?? "msg"}` };
  if (status && status >= 500) return { kind: "availability", retryable: true, fatal: false, reason: `availability:${status}` };
  if (status && status >= 400) return { kind: "execution", retryable: statusFromText ? true : false, fatal: false, reason: `execution:${status}` };
  if (input?.aborted) return { kind: "aborted", retryable: !input?.hadOutput, fatal: false, reason: "aborted" };
  return { kind: "execution", retryable: true, fatal: false, reason: "execution:unknown" };
}

export function planFallback(ranked, failure, attemptIndex, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  if (failure.fatal) return { stop: true, reason: `fatal:${failure.kind}` };
  if (!failure.retryable) return { stop: true, reason: `non-retryable:${failure.kind}` };
  if (attemptIndex + 1 >= maxAttempts) return { stop: true, reason: "attempt-budget-exhausted" };
  const next = ranked[attemptIndex + 1];
  if (!next) return { stop: true, reason: "no-candidates-left" };
  return { next, stop: false, reason: `fallback:${failure.kind}` };
}

// ── Discovery + filtering ───────────────────────────────────────────
export function discoverCandidates(all, available) {
  const source = Array.isArray(available) && available.length > 0 ? available : (Array.isArray(all) ? all : []);
  const seen = new Set();
  const out = [];
  for (const m of source) {
    if (!m || m.provider === FAS_PROVIDER) continue;
    const k = modelKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

export function hardFilter(models, task) {
  const t = task ?? {};
  return (models ?? []).filter((m) => {
    if (!m || m.provider === FAS_PROVIDER) return false;
    if (t.requiredInput && t.requiredInput.length) {
      const inp = Array.isArray(m.input) ? m.input : ["text"];
      if (!t.requiredInput.every((x) => inp.includes(x))) return false;
    }
    if (t.minContextWindow && (m.contextWindow ?? 0) < t.minContextWindow) return false;
    if (t.needsReasoning && !m.reasoning) return false;
    if (t.excludedProviders && t.excludedProviders.includes(m.provider)) return false;
    if (t.excludedModels && t.excludedModels.includes(modelKey(m))) return false;
    return true;
  });
}

// ─ Centralized scoring + selection ─────────────────────────────────
export function scoreCandidate(model, task, store) {
  const t = task ?? {};
  let s = 0;
  if (t.preferredProvider && t.preferredProvider === model.provider) s += 5;
  const st = candidateStats(store, model);
  if (st) {
    s += Math.min(st.successes, 10);
    s -= Math.min(st.failures, 10) * 1.5;
    s -= Math.min(st.consecutiveFailures, 5) * 2;
    if (st.avgLatencyMs > 0) s -= Math.min(3, st.avgLatencyMs / 20000);
  }
  if (t.needsReasoning) { if (model.reasoning) s += 2; }
  else s += model.reasoning ? 0.5 : 1.5;
  // Catalogs mark free/special pricing with zero or NEGATIVE cost. Clamp at
  // zero so a negative marker can never become a runaway ranking bonus
  // (observed: cost.input -1000000 scored +100000, pinning dead lanes first).
  if (model.cost && typeof model.cost.input === "number") s -= Math.min(2, Math.max(0, model.cost.input / 10));
  return s;
}

export function rankCandidates(models, task, store, nowMs = Date.now()) {
  const pool = hardFilter(models, task);
  const ranked = pool
    .filter((m) => !shouldSkipCandidate(store, m, nowMs))
    .map((m) => ({ model: m, score: scoreCandidate(m, task, store) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const sa = candidateStats(store, a.model), sb = candidateStats(store, b.model);
      const suc = (sb?.successes ?? 0) - (sa?.successes ?? 0);
      if (suc !== 0) return suc;
      const la = sa?.avgLatencyMs ?? Infinity, lb = sb?.avgLatencyMs ?? Infinity;
      if (la !== lb) return la - lb;
      return modelKey(a.model).localeCompare(modelKey(b.model));
    })
    .map((x) => x.model);
  // Fail-safe: if every candidate is penalized, still return the pool (bounded retries
  // prevent loops) rather than silently routing nothing.
  return ranked.length > 0 ? ranked : pool;
}

/** Provider-local shortlists — discovery/reporting only, never the final decision. */
export function shortlistPerProvider(models, task, store, opts = {}) {
  const size = opts.size ?? SHORTLIST_SIZE;
  const ranked = rankCandidates(models, task, store);
  const byProvider = {};
  for (const m of ranked) (byProvider[m.provider] ||= []).push(m);
  const out = {};
  for (const [p, list] of Object.entries(byProvider)) out[p] = list.slice(0, size);
  return out;
}

/** One normalized global pool (deduplicated) for the centralized decision. */
export function normalizePool(models) {
  const seen = new Set();
  const out = [];
  for (const m of models ?? []) {
    if (!m) continue;
    const k = modelKey(m);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

// ── Thinking / budget policy ────────────────────────────────────────
export function selectMinThinkingLevel(model) {
  if (!model) return "off";
  if (!model.reasoning) return "off";
  const map = model.thinkingLevelMap;
  if (map && typeof map === "object") {
    for (const lvl of THINKING_LEVELS) if (map[lvl] !== undefined && map[lvl] !== null) return lvl;
  }
  return "minimal";
}

export function nextThinkingLevel(current) {
  const i = THINKING_LEVELS.indexOf(current);
  return i < 0 || i >= THINKING_LEVELS.length - 1 ? null : THINKING_LEVELS[i + 1];
}

function nextSupportedThinkingLevel(model, current) {
  const map = model?.thinkingLevelMap;
  let lvl = nextThinkingLevel(current);
  while (lvl) {
    if (!map || (map[lvl] !== undefined && map[lvl] !== null)) return lvl;
    lvl = nextThinkingLevel(lvl);
  }
  return null;
}

export function decideThinking(model, current, evidence = {}) {
  if (!model || !model.reasoning) return { level: "off", changed: current !== "off", reason: "no-reasoning-support" };
  const min = selectMinThinkingLevel(model);
  if (current === "off" || current === undefined) return { level: min === "off" ? "minimal" : min, changed: true, reason: "min-sufficient" };
  if (evidence.insufficient) {
    const next = nextSupportedThinkingLevel(model, current);
    if (next) return { level: next, changed: true, reason: "evidence-insufficient" };
  }
  return { level: current, changed: false, reason: "sufficient" };
}

export function planBudgets(model, contextUsage) {
  const maxOutputTokens = (model && model.maxTokens) || 0;
  if (!contextUsage || contextUsage.tokens === null || contextUsage.tokens === undefined || !contextUsage.contextWindow) {
    return { maxOutputTokens, maxRounds: DEFAULT_MAX_ROUNDS, compact: false, trim: false, reason: "no-telemetry" };
  }
  const remaining = Math.max(0, contextUsage.contextWindow - contextUsage.tokens);
  const maxRounds = Math.max(1, Math.floor(remaining / 8000));
  const compact = (contextUsage.percent ?? 0) > 85;
  const trim = contextUsage.tokens > contextUsage.contextWindow - 20000;
  return { maxOutputTokens, maxRounds, compact, trim, reason: compact ? "context-high" : "context-ok" };
}

// ── Task inference (bounded, no heuristics beyond observable inputs) ─
export function inferTask(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  const hasImage = messages.some((m) => Array.isArray(m?.content) && m.content.some((c) => c?.type === "image"));
  const toolCount = Array.isArray(context?.tools) ? context.tools.length : 0;
  const complexity = toolCount > 6 ? "high" : toolCount > 0 ? "medium" : "low";
  const task = { complexity };
  if (hasImage) task.requiredInput = ["text", "image"];
  if (complexity === "high") task.needsReasoning = true;
  return task;
}

// ── Streaming supervisor ────────────────────────────────────────────
/**
 * Complete, valid Pi AssistantMessage for terminal failures.
 *
 * AssistantMessageEventStream resolves the stream result from the terminal
 * error event's `error` field; pi-agent-core gates on `stopReason ===
 * "error"` and reads `message.content.filter`. An incomplete object here
 * crashes the agent loop (TypeError: Cannot read properties of undefined
 * (reading 'filter')). content MUST be an array.
 */
export function errorAssistantMessage(model, message) {
  return {
    role: "assistant",
    content: [],
    api: model?.api ?? "openai-completions",
    provider: model?.provider ?? FAS_PROVIDER,
    model: model?.id ?? FAS_MODEL_ID,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now(),
  };
}

/** Emit a terminal error as a complete AssistantMessage (never a bare object). */
function pushError(outer, model, message) {
  const msg = errorAssistantMessage(model, message);
  outer.push({ type: "error", reason: "error", error: msg });
  outer.end(msg);
}

/**
 * Provider-aware candidate dispatch.
 *
 * Prefers the candidate provider's own composed streamSimple (the supported
 * provider-aware execution path: `modelRegistry.getProvider(providerId)` returns
 * the effective pi-ai provider whose streamSimple dispatches extension-registered
 * custom providers by api id — e.g. free-router/auto — then base providers, then
 * the pi-ai api registry). Falls back to the pi-ai compat dispatch when the
 * registry or provider is unavailable.
 */
export function makeStreamCandidate(deps, compatStream) {
  return (model, context, options) => {
    const registry = deps.getRegistry ? deps.getRegistry() : undefined;
    let provider;
    try { provider = registry?.getProvider?.(model?.provider); } catch { provider = undefined; }
    if (provider && typeof provider.streamSimple === "function") {
      return provider.streamSimple(model, context, options);
    }
    return compatStream(model, context, options);
  };
}

/** Honest classification of every FAS budget against the actual Extension API. */
export function budgetStates() {
  return [
    { budget: "maxOutputTokens", state: "ENFORCED", detail: "candidate maxTokens is passed to the provider request (observed on the wire as max_completion_tokens)" },
    { budget: "compact", state: "CORE-DELEGATED", detail: "ctx.compact() triggers Pi's compaction engine above 85% context; execution is Pi core's" },
    { budget: "maxRounds", state: "ADVISORY-ONLY", detail: "reported by /token-efficiency; no supported extension-level API limits agent-loop rounds" },
    { budget: "trim", state: "ADVISORY-ONLY", detail: "computed in planBudgets; no supported extension-level API rewrites session history" },
  ];
}

function logEvidence(deps, rec) { try { deps.log({ type: "fas-evidence", ...rec }); } catch { /* logging must never break routing */ } }

async function forwardStream(outer, iterable, onEvent) {
  let pushedContent = false;
  const it = iterable[Symbol.asyncIterator]();
  for (;;) {
    const r = await it.next();
    if (r.done) return { ok: pushedContent, ended: true, failure: pushedContent ? null : { errorMessage: "empty stream" } };
    const ev = r.value;
    if (ev.type === "error") return { ok: false, failure: { status: ev.error?.status, errorMessage: ev.error?.errorMessage ?? "provider error" }, pushedContent };
    if (ev.type === "done") { outer.push(ev); return { ok: true, final: ev.message, pushedContent: true }; }
    if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "toolcall_delta") pushedContent = true;
    if (ev.type === "text_end" || ev.type === "thinking_end") pushedContent = true;
    outer.push(ev);
  }
}

async function streamViaFallback(deps, outer, context, options, reason, model) {
  const fb = deps.fallbackModel && deps.fallbackModel();
  if (!fb) {
    pushError(outer, model, `FAS router: ${reason}; no fallback model available`);
    return;
  }
  try {
    const auth = await deps.getAuth(fb);
    const m = !auth || auth.ok === false ? fb : { ...fb, baseUrl: auth.baseUrl ?? fb.baseUrl };
    const fbOptions = !auth || auth.ok === false ? options : { ...options, apiKey: auth.apiKey, headers: auth.headers, env: auth.env };
    const outcome = await forwardStream(outer, deps.streamCandidate(m, context, fbOptions), null);
    if (outcome.ok) outer.end(outcome.final);
    else pushError(outer, model, `FAS router fallback failed: ${outcome.failure?.errorMessage ?? "unknown"}`);
  } catch (e) {
    pushError(outer, model, `FAS router fallback error: ${e?.message ?? "unknown"}`);
  }
}

/** The fas-router provider streamSimple implementation. */
export function runRouterStream(deps, model, context, options = {}) {
  const outer = deps.createEventStream();
  void (async () => {
    try {
      const store = (deps.loadKnowledge && deps.loadKnowledge()) || newEvidenceStore();
      const pool = discoverCandidates(deps.getCandidates ? deps.getCandidates() : [], deps.getAvailable ? deps.getAvailable() : undefined);
      const task = inferTask(context);
      const ranked = rankCandidates(pool, task, store, deps.now ? deps.now() : Date.now());
      const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      if (ranked.length === 0) { await streamViaFallback(deps, outer, context, options, "no eligible candidate", model); return; }

      let storeMut = store;
      const persist = (rec) => {
        // Stamp recency at persist time so eviction is recency-based, not
        // alphabetical: without `at`, every lastSeen collapses to
        // store.updatedAt (0 in production) and evict() would evict
        // just-learned rules arbitrarily.
        storeMut = recordOutcome(storeMut, { at: deps.now ? deps.now() : Date.now(), ...rec });
        logEvidence(deps, buildEvidenceRecord(rec));
        try { deps.saveKnowledge && deps.saveKnowledge(storeMut); } catch { /* persistence must never break routing */ }
      };

      // F3 v1 — within-turn provider circuit breaker: after a provider fails
      // this turn, prefer untried candidates from OTHER providers before burning
      // another lane of the same (possibly credit-dead) provider. Preference only —
      // with no alternative provider the rank order stands (see T15 bounds).
      const tried = new Set();
      const failedProviders = new Set();
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const cand = ranked.find((m) => !tried.has(modelKey(m)) && !failedProviders.has(m.provider))
          ?? ranked.find((m) => !tried.has(modelKey(m)));
        if (!cand) break;
        tried.add(modelKey(cand));
        const startedAt = deps.now ? deps.now() : Date.now();
        try {
          const auth = await deps.getAuth(cand);
          if (!auth || auth.ok === false) {
            const f = classifyFailure({ status: 401, errorMessage: auth && auth.error });
            persist({ provider: cand.provider, id: cand.id, ok: false, kind: f.kind, latencyMs: 0, status: 401, error: (auth && auth.error) || undefined, reason: f.reason });
            failedProviders.add(cand.provider);
            if (planFallback(ranked, f, attempt, maxAttempts).stop) break;
            continue;
          }
          const thinking = decideThinking(cand, options.reasoning ?? "off", {});
          const candOptions = { ...options, reasoning: thinking.level === "off" ? undefined : thinking.level, apiKey: auth.apiKey, headers: auth.headers, env: auth.env };
          const prepared = { ...cand, baseUrl: auth.baseUrl ?? cand.baseUrl };
          const outcome = await forwardStream(outer, deps.streamCandidate(prepared, context, candOptions), null);
          const latencyMs = (deps.now ? deps.now() : Date.now()) - startedAt;
          if (outcome.ok) {
            persist({ provider: cand.provider, id: cand.id, ok: true, latencyMs, tokens: outcome.final?.usage?.input + outcome.final?.usage?.output || undefined });
            outer.end(outcome.final);
            return;
          }
          // Content already streamed → surface error rather than corrupting output with a retry.
          if (outcome.pushedContent) {
            persist({ provider: cand.provider, id: cand.id, ok: false, kind: "execution", latencyMs, status: outcome.failure?.status, error: outcome.failure?.errorMessage, reason: "failure-after-content" });
            pushError(outer, model, outcome.failure?.errorMessage ?? "provider error after output");
            return;
          }
          const f = classifyFailure(outcome.failure ?? {});
          persist({ provider: cand.provider, id: cand.id, ok: false, kind: f.kind, status: outcome.failure?.status, error: outcome.failure?.errorMessage, latencyMs, reason: f.reason });
          failedProviders.add(cand.provider);
          if (planFallback(ranked, f, attempt, maxAttempts).stop) break;
        } catch (e) {
          const f = classifyFailure({ errorMessage: e?.message, aborted: false });
          persist({ provider: cand.provider, id: cand.id, ok: false, kind: f.kind, error: e?.message, latencyMs: (deps.now ? deps.now() : Date.now()) - startedAt, reason: f.reason });
          failedProviders.add(cand.provider);
          if (planFallback(ranked, f, attempt, maxAttempts).stop) break;
        }
      }
      await streamViaFallback(deps, outer, context, options, "all candidates failed or budget exhausted", model);
    } catch (e) {
      try {
        pushError(outer, model, `FAS router failure: ${e?.message ?? "unknown"}`);
      } catch { /* nothing else we can do */ }
    }
  })();
  return outer;
}

export function buildProviderConfig(deps) {
  return {
    name: "FAS Router",
    baseUrl: "https://fas-router.invalid/v1",
    apiKey: "fas-router-internal",
    api: "openai-completions",
    models: [{
      id: FAS_MODEL_ID,
      name: "FAS Router Auto",
      reasoning: true,
      thinkingLevelMap: FAS_THINKING_MAP,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }],
    streamSimple: (model, context, options) => runRouterStream(deps, model, context, options),
  };
}

// ── Extension wiring (thin, injected, fail-safe) ────────────────────
export function installFas(pi, deps) {
  const state = { active: false, previousModel: undefined };
  let store = (deps.loadKnowledge && deps.loadKnowledge()) || newEvidenceStore();

  pi.registerProvider(FAS_PROVIDER, buildProviderConfig(deps));

  pi.on("model_select", async (_event, ctx) => {
    try {
      const m = ctx.model;
      const current = ctx.thinkingLevel;
      if (!m || !m.reasoning) { if (current !== "off") pi.setThinkingLevel("off"); return; }
      const min = selectMinThinkingLevel(m);
      if (current === "off" && min !== "off") pi.setThinkingLevel(min);
    } catch { /* never disrupt the agent */ }
  });

  pi.on("turn_end", async (_event, ctx) => {
    try {
      const usage = ctx.getContextUsage();
      const budgets = planBudgets(ctx.model, usage);
      // Compaction is CORE-DELEGATED: `budgets.compact` (>85%) is an ADVISORY
      // signal only. Pi core performs threshold compaction itself, awaited and
      // serialized (`_compactBeforeNextAssistantResponse` / `_checkCompaction`,
      // contextWindow - reserveTokens). FAS must not issue manual
      // `ctx.compact()` calls here: turn_end fires once per assistant turn (so
      // several times per tool-using response) while compaction runs for
      // seconds, and Pi 0.85.1's `compact()` has no re-entrancy guard —
      // overlapping calls clear each other's `_compactionAbortController` and
      // the survivor throws `Cannot read properties of undefined (reading
      // 'signal')` (`Compaction failed: ...`). `compact()` also starts with
      // `await this.abort()`, which would abort the in-flight turn.
      if (usage && usage.tokens !== null) {
        const d = decideThinking(ctx.model, ctx.thinkingLevel, { insufficient: budgets.reason === "context-high" });
        if (d.changed) pi.setThinkingLevel(d.level);
      }
    } catch { /* never disrupt the agent */ }
  });

  pi.registerCommand("fas-router:on", {
    description: "Activate the FAS central router (fas-router/auto)",
    handler: async (_args, ctx) => {
      try {
        state.previousModel = (deps.getCurrentModel && deps.getCurrentModel()) || ctx.model;
        const routerModel = (deps.findModel && deps.findModel(FAS_PROVIDER, FAS_MODEL_ID)) || (ctx.modelRegistry && ctx.modelRegistry.find && ctx.modelRegistry.find(FAS_PROVIDER, FAS_MODEL_ID));
        if (!routerModel) { ctx.ui.notify("FAS: router model unavailable", "error"); return; }
        const ok = await pi.setModel(routerModel);
        state.active = !!ok;
        ctx.ui.notify(ok ? "FAS router active (fas-router/auto)" : "FAS: activation failed (no auth)", ok ? "info" : "error");
      } catch (e) { ctx.ui.notify(`FAS: ${e?.message ?? "activation error"}`, "error"); }
    },
  });

  pi.registerCommand("fas-router:off", {
    description: "Deactivate the FAS router and restore the previous model",
    handler: async (_args, ctx) => {
      try {
        const target = state.previousModel || (deps.fallbackModel && deps.fallbackModel());
        if (!target) { ctx.ui.notify("FAS: no previous model to restore", "warning"); return; }
        const ok = await pi.setModel(target);
        state.active = false;
        ctx.ui.notify(ok ? `FAS router disabled → ${target.provider}/${target.id}` : "FAS: restore failed", ok ? "info" : "error");
      } catch (e) { ctx.ui.notify(`FAS: ${e?.message ?? "deactivation error"}`, "error"); }
    },
  });

  pi.registerCommand("fas-router:status", {
    description: "Show FAS supervisor status, shortlists, and learned rules",
    handler: async (_args, ctx) => {
      try {
        const pool = discoverCandidates(deps.getCandidates ? deps.getCandidates() : [], deps.getAvailable ? deps.getAvailable() : undefined);
        const task = inferTask({});
        const shortlists = shortlistPerProvider(pool, task, store);
        const rules = learningRules(store);
        let msg = "FAS Router Status\n" + "─".repeat(40) + "\n";
        msg += `Active: ${state.active ? "yes" : "no"}\n`;
        msg += `Candidates: ${pool.length}\n`;
        for (const [p, list] of Object.entries(shortlists)) msg += `  ${p}: ${list.map((m) => m.id).join(", ")}\n`;
        msg += `Learned rules: ${rules.length}\n`;
        for (const r of rules.slice(0, 10)) msg += `  ${r.type} ${r.provider}/${r.id} (${r.reason})\n`;
        ctx.ui.notify(msg, "info");
      } catch { ctx.ui.notify("FAS: status unavailable", "error"); }
    },
  });

  // Backward-compatible token-efficiency report (existing behavior preserved).
  pi.registerCommand("token-efficiency", {
    description: "Show FAS token efficiency metrics and model configuration",
    handler: async (_args, ctx) => {
      try {
        const model = ctx.model;
        const usage = ctx.getContextUsage();
        const budgets = planBudgets(model, usage);
        const level = ctx.thinkingLevel;
        let msg = "FAS Token Efficiency Report\n" + "─".repeat(40) + "\n";
        msg += `Thinking Level: ${level}\n`;
        if (model) {
          msg += `Model: ${model.name || model.id}\nProvider: ${model.provider}\n`;
          msg += `Reasoning: ${model.reasoning ? "yes" : "no"}\n`;
          msg += `Context Window: ${(model.contextWindow || 0).toLocaleString()}\n`;
          msg += `Max Output Tokens: ${budgets.maxOutputTokens.toLocaleString()}\n`;
          if (model.thinkingLevelMap) {
            const available = Object.entries(model.thinkingLevelMap).filter(([, v]) => v !== null && v !== undefined).map(([k]) => k).join(", ") || "none";
            msg += `Available Thinking Levels: ${available}\n`;
          }
        } else msg += "Model: not loaded\n";
        msg += `Round Budget: ${budgets.maxRounds} (advisory)\n`;
        for (const s of budgetStates()) msg += `Budget ${s.budget}: ${s.state}\n`;
        if (usage && usage.tokens !== null) msg += `Context: ${usage.tokens.toLocaleString()} / ${(usage.contextWindow || 0).toLocaleString()} (${usage.percent?.toFixed(1)}%)\n`;
        else msg += "Context: unavailable (telemetry disabled)\n";
        msg += "─".repeat(40) + "\nFAS operates in evidence-based mode.\n";
        ctx.ui.notify(msg, "info");
      } catch { ctx.ui.notify("FAS: unable to report metrics", "error"); }
    },
  });

  return state;
}