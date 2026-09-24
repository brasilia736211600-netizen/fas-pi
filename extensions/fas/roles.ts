/**
 * Role + capability mapping (Phase 2C).
 *
 * Pure module: no imports, no I/O, no model calls, no auto-classification.
 * A role translates to constraints over PRE-EXISTING FAS task fields only
 * (requiredInput, minContextWindow, needsReasoning, excludedProviders,
 * excludedModels, preferredProvider — consumed by the centralized ranker in
 * core.ts). Routing itself stays 100% inside that ranker;
 * this module adds no scores, weights, or second ranking pass.
 *
 * Role choice is explicit (declared by the orchestrator), never inferred by
 * an LLM: there is deliberately no resolveRole/classifyRole export.
 */

export const FAS_ROLES = [
  "explorer",
  "implementer",
  "tester",
  "reviewer",
  "debugger",
] as const;
export type FasRole = (typeof FAS_ROLES)[number];

export interface RoleTaskConstraints {
  requiredInput?: string[];
  minContextWindow?: number;
  needsReasoning?: boolean;
  excludedProviders?: string[];
  excludedModels?: string[];
  preferredProvider?: string;
}

/**
 * Policy constants are explicit and tested, not derived: they compose existing
 * scorer behavior (non-reasoning +1.5 bonus, reasoning +2 bonus, context filter).
 */
export function roleTaskConstraints(role: FasRole | string): RoleTaskConstraints {
  switch (role) {
    case "explorer":
      // Cheap direct lookup: non-reasoning models rank up via the existing scorer bonus.
      return { needsReasoning: false };
    case "implementer":
      // General build work: full pool, evidence decides.
      return {};
    case "tester":
      // Repeatable verification over cleverness; evidence picks within.
      return { needsReasoning: false };
    case "reviewer":
      // Reviews need room for diffs + file context; 64k is the policy floor.
      return { minContextWindow: 64000 };
    case "debugger":
      // Diagnostic work takes the reasoning path (existing filter + bonus).
      return { needsReasoning: true };
    default:
      throw new Error(`roleTaskConstraints: unknown role: ${String(role)}`);
  }
}

/** Contract fields a role additionally requires on status "ok" (schema rules still apply). */
export function roleRequiredFields(role: FasRole | string): string[] {
  if (role === "tester") return ["tests_run"];
  if (! (FAS_ROLES as readonly string[]).includes(String(role))) {
    throw new Error(`roleRequiredFields: unknown role: ${String(role)}`);
  }
  return [];
}

export interface RoleContractCheck {
  valid: boolean;
  errors: string[];
}

/** Validate role-required fields against an already-parsed child result. Never throws. */
export function validateRoleContract(
  role: FasRole | string,
  result: {
    status?: unknown;
    report?: unknown;
    tests_run?: unknown;
    files_modified?: unknown;
    files_created?: unknown;
  } | null | undefined,
): RoleContractCheck {
  if (! (FAS_ROLES as readonly string[]).includes(String(role))) {
    return { valid: false, errors: [`unknown role: ${String(role)}`] };
  }
  if (!result || typeof result !== "object") {
    return { valid: false, errors: ["result must be an object"] };
  }
  // Honest failure must never be rejected for missing evidence fields.
  if (result.status !== "ok") return { valid: true, errors: [] };
  const errors: string[] = [];
  for (const field of roleRequiredFields(role)) {
    const value = (result as Record<string, unknown>)[field];
    if (!Array.isArray(value) || value.length === 0 || !value.every((x) => typeof x === "string" && x.trim())) {
      errors.push(`role "${String(role)}" requires non-empty "${field}" on status "ok"`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Short emission instruction for role-spawned children (pay-per-use, not global prompt). */
export function rolePromptSnippet(role: FasRole | string): string {
  if (! (FAS_ROLES as readonly string[]).includes(String(role))) {
    throw new Error(`rolePromptSnippet: unknown role: ${String(role)}`);
  }
  const required = roleRequiredFields(role);
  const extra =
    required.length > 0
      ? ` On status "ok" you MUST include non-empty "${required.join('", "')}".`
      : "";
  return [
    `Role: ${String(role)}. End your final answer with a \`\`\`fas-result JSON block:`,
    `{"status": "ok"|"fail"|"blocked", "report": "<markdown>", "files_modified": [], "files_created": [], "tests_run": [], "problems": [], "conflicts": []}.${extra}`,
    `Use "fail"/"blocked" honestly instead of an empty success.`,
  ].join("\n");
}
