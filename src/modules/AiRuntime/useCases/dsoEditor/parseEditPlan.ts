import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { type EditPlan, EDIT_PLAN_JSON_SCHEMA } from '../../models/DsoTypes';

/**
 * Hard upper bound on the response we will scan for an embedded JSON object.
 * The LLM emits at most ~2k tokens; 16 kB of characters comfortably covers a
 * full EditPlan while bounding the cost of the salvage scan so that malformed
 * (e.g. prompt-injected) output cannot turn parsing into a DoS.
 */
const MAX_SALVAGE_LENGTH = 16 * 1024;

/** The set of valid DSO `op` values, derived from the schema (single source of truth). */
const VALID_DSO_OPS: ReadonlySet<string> = (() => {
    try {
        const schema = JSON.parse(EDIT_PLAN_JSON_SCHEMA) as {
            properties?: { dsos?: { items?: { properties?: { op?: { enum?: unknown } } } } };
        };
        const ops = schema.properties?.dsos?.items?.properties?.op?.enum;
        return new Set(Array.isArray(ops) ? ops.filter((op): op is string => typeof op === 'string') : []);
    } catch {
        return new Set<string>();
    }
})();

const VALID_MODERATIONS: ReadonlySet<string> = new Set(['allow', 'needs_confirmation', 'block']);

/**
 * Scan `text` for the first complete, brace-balanced JSON object, honoring
 * string literals and escapes so braces inside strings do not unbalance the
 * scan. Returns the object substring or `null` if none completes within the
 * scanned window. Linear-time — no backtracking.
 */
function extractBalancedJsonObject(text: string): string | null {
    const scanLimit = Math.min(text.length, MAX_SALVAGE_LENGTH);
    const start = text.indexOf('{');
    if (start === -1 || start >= scanLimit) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < scanLimit; index++) {
        const ch = text[index]!;
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }
    return null;
}

/**
 * Validate a parsed object against the EditPlan shape: the envelope fields
 * (`kind`, `moderation`, `intent`, `dsos`) and every DSO entry's `op`. Returns
 * an error string describing the first violation, or `null` when valid. This
 * guards against an LLM emitting JSON that parses but is not a usable plan.
 */
function validateEditPlanShape(parsed: Record<string, unknown>): string | null {
    if (parsed.kind !== 'edit_plan') {
        return 'missing or invalid "kind" (expected "edit_plan")';
    }
    if (typeof parsed.moderation !== 'string' || !VALID_MODERATIONS.has(parsed.moderation)) {
        return 'missing or invalid "moderation" (expected allow | needs_confirmation | block)';
    }
    if (typeof parsed.intent !== 'string') {
        return 'missing or invalid "intent" (expected a string)';
    }
    if (!Array.isArray(parsed.dsos)) {
        return 'missing or invalid "dsos" (expected an array)';
    }
    for (let index = 0; index < parsed.dsos.length; index++) {
        const dso = parsed.dsos[index] as unknown;
        if (typeof dso !== 'object' || dso === null) {
            return `dsos[${index}] is not an object`;
        }
        const op = (dso as Record<string, unknown>).op;
        if (typeof op !== 'string' || !VALID_DSO_OPS.has(op)) {
            return `dsos[${index}] has missing or unknown "op"${typeof op === 'string' ? ` ("${op}")` : ''}`;
        }
    }
    return null;
}

export function parseEditPlan(responseText: string): EditPlan {
    // Strip any residual <think>…</think> that wasn't caught by extractReasoning
    const clean = responseText.replaceAll(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 1. Try direct parse on the clean response
    try {
        const parsed = JSON.parse(clean) as Record<string, unknown>;
        if (validateEditPlanShape(parsed) === null) {
            return parsed as EditPlan;
        }
    } catch {
        // fall through to brace-balanced salvage
    }

    // 2. Salvage: extract the first complete, brace-balanced JSON object.
    //    A linear-time, escape-aware scan with a hard size cap — no greedy
    //    regex, so malformed/adversarial output cannot trigger catastrophic
    //    backtracking inside the generation loop.
    const candidate = extractBalancedJsonObject(clean);
    const preview = clean.slice(0, 120).replaceAll('\n', ' ');
    if (candidate) {
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(candidate) as Record<string, unknown>;
        } catch (error) {
            throw createAiRuntimeError(
                `LLM returned malformed JSON (${error instanceof Error ? error.message : String(error)}). ` +
                    `Response preview: "${preview}…" — ` +
                    `The model may have run out of tokens mid-response. Try a simpler request or increase max_tokens.`
            );
        }
        const shapeError = validateEditPlanShape(parsed);
        if (shapeError === null) {
            return parsed as EditPlan;
        }
        throw createAiRuntimeError(`LLM response is not a valid EditPlan (${shapeError}). Preview: "${preview}…"`);
    }

    throw createAiRuntimeError(`LLM response is not a valid EditPlan. Preview: "${preview}…"`);
}
