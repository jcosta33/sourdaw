/**
 * The strict argument contract for one `recipe.discover` call.
 *
 * Bounded the same way the other application-owned tool contracts are: one
 * function reads the exact key set and value shape a provider may send, so
 * every caller sees the same refusal for the same malformed input. The valid
 * role set is supplied by the caller rather than imported here, because it is
 * catalog data this module does not own.
 */

export type RecipeDiscoveryInput = {
    descriptors: readonly string[];
    presetTerms: readonly string[];
    targetId: string | null;
    role: string | null;
    limit: number;
};

type ParsedRecipeDiscoveryInput =
    { status: 'valid'; input: RecipeDiscoveryInput } | { status: 'invalid'; reason: string };

const MIN_TERMS = 1;
const MAX_TERMS = 4;
const MAX_TERM_LENGTH = 48;
const MAX_TARGET_ID_LENGTH = 256;
const MIN_LIMIT = 1;
const MAX_LIMIT = 8;
const DEFAULT_LIMIT = 4;
const ALLOWED_KEYS = ['descriptors', 'presetTerms', 'targetId', 'role', 'limit'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isAllowedKey(key: string): key is (typeof ALLOWED_KEYS)[number] {
    return ALLOWED_KEYS.some((candidate) => candidate === key);
}

/** Null when the value is not an array of 1 to 4 bounded strings. */
function parseTerms(value: unknown): readonly string[] | null {
    if (!Array.isArray(value) || value.length < MIN_TERMS || value.length > MAX_TERMS) {
        return null;
    }
    const terms: string[] = [];
    for (const entry of value) {
        if (!isBoundedString(entry, MAX_TERM_LENGTH)) {
            return null;
        }
        terms.push(entry);
    }
    return terms;
}

/** An absent list is an empty one; a present list must satisfy the term bounds. */
function parseOptionalTerms(value: unknown): readonly string[] | null {
    return value === undefined ? [] : parseTerms(value);
}

function isOptionalLimit(value: unknown): boolean {
    return (
        value === undefined ||
        (typeof value === 'number' && Number.isInteger(value) && value >= MIN_LIMIT && value <= MAX_LIMIT)
    );
}

export function parseRecipeDiscoveryInput(
    argumentsValue: unknown,
    catalogRoles: readonly string[]
): ParsedRecipeDiscoveryInput {
    if (!isRecord(argumentsValue) || Object.keys(argumentsValue).some((key) => !isAllowedKey(key))) {
        return { status: 'invalid', reason: 'recipe.discover arguments do not match the strict discovery contract' };
    }
    const descriptors = parseOptionalTerms(argumentsValue.descriptors);
    if (descriptors === null) {
        return {
            status: 'invalid',
            reason: `recipe.discover descriptors must be ${String(MIN_TERMS)} to ${String(MAX_TERMS)} bounded terms`,
        };
    }
    const presetTerms = parseOptionalTerms(argumentsValue.presetTerms);
    if (presetTerms === null) {
        return {
            status: 'invalid',
            reason: `recipe.discover presetTerms must be ${String(MIN_TERMS)} to ${String(MAX_TERMS)} bounded terms`,
        };
    }
    if (argumentsValue.targetId !== undefined && !isBoundedString(argumentsValue.targetId, MAX_TARGET_ID_LENGTH)) {
        return { status: 'invalid', reason: 'recipe.discover targetId must be a bounded non-empty string' };
    }
    if (
        argumentsValue.role !== undefined &&
        (typeof argumentsValue.role !== 'string' || !catalogRoles.includes(argumentsValue.role))
    ) {
        return { status: 'invalid', reason: 'recipe.discover role must be one of the catalog roles' };
    }
    if (!isOptionalLimit(argumentsValue.limit)) {
        return {
            status: 'invalid',
            reason: `recipe.discover limit must be an integer from ${String(MIN_LIMIT)} to ${String(MAX_LIMIT)}`,
        };
    }
    if (descriptors.length === 0 && presetTerms.length === 0 && argumentsValue.role === undefined) {
        return {
            status: 'invalid',
            reason: 'recipe.discover requires descriptors, presetTerms or a role',
        };
    }
    return {
        status: 'valid',
        input: {
            descriptors,
            presetTerms,
            targetId: typeof argumentsValue.targetId === 'string' ? argumentsValue.targetId : null,
            role: typeof argumentsValue.role === 'string' ? argumentsValue.role : null,
            limit: typeof argumentsValue.limit === 'number' ? argumentsValue.limit : DEFAULT_LIMIT,
        },
    };
}
