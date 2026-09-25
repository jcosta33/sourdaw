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
    targetId: string | null;
    role: string | null;
    limit: number;
};

type ParsedRecipeDiscoveryInput =
    { status: 'valid'; input: RecipeDiscoveryInput } | { status: 'invalid'; reason: string };

const MIN_DESCRIPTORS = 1;
const MAX_DESCRIPTORS = 4;
const MAX_DESCRIPTOR_LENGTH = 48;
const MAX_TARGET_ID_LENGTH = 256;
const MIN_LIMIT = 1;
const MAX_LIMIT = 8;
const DEFAULT_LIMIT = 4;
const ALLOWED_KEYS = ['descriptors', 'targetId', 'role', 'limit'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isAllowedKey(key: string): key is (typeof ALLOWED_KEYS)[number] {
    return ALLOWED_KEYS.some((candidate) => candidate === key);
}

function parseDescriptors(value: unknown): readonly string[] | null {
    if (!Array.isArray(value) || value.length < MIN_DESCRIPTORS || value.length > MAX_DESCRIPTORS) {
        return null;
    }
    const descriptors: string[] = [];
    for (const entry of value) {
        if (!isBoundedString(entry, MAX_DESCRIPTOR_LENGTH)) {
            return null;
        }
        descriptors.push(entry);
    }
    return descriptors;
}

export function parseRecipeDiscoveryInput(
    argumentsValue: unknown,
    catalogRoles: readonly string[]
): ParsedRecipeDiscoveryInput {
    if (!isRecord(argumentsValue) || Object.keys(argumentsValue).some((key) => !isAllowedKey(key))) {
        return { status: 'invalid', reason: 'recipe.discover arguments do not match the strict discovery contract' };
    }
    const descriptors = parseDescriptors(argumentsValue.descriptors);
    if (!descriptors) {
        return {
            status: 'invalid',
            reason: `recipe.discover requires ${String(MIN_DESCRIPTORS)} to ${String(MAX_DESCRIPTORS)} bounded descriptor terms`,
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
    if (
        argumentsValue.limit !== undefined &&
        (typeof argumentsValue.limit !== 'number' ||
            !Number.isInteger(argumentsValue.limit) ||
            argumentsValue.limit < MIN_LIMIT ||
            argumentsValue.limit > MAX_LIMIT)
    ) {
        return {
            status: 'invalid',
            reason: `recipe.discover limit must be an integer from ${String(MIN_LIMIT)} to ${String(MAX_LIMIT)}`,
        };
    }
    return {
        status: 'valid',
        input: {
            descriptors,
            targetId: typeof argumentsValue.targetId === 'string' ? argumentsValue.targetId : null,
            role: typeof argumentsValue.role === 'string' ? argumentsValue.role : null,
            limit: typeof argumentsValue.limit === 'number' ? argumentsValue.limit : DEFAULT_LIMIT,
        },
    };
}
