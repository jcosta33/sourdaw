/**
 * The strict argument contract for one `recipe.expand` call.
 *
 * One function reads the exact key set and value shape a provider may send, so every caller sees
 * the same refusal for the same malformed input. As with `recipe.discover`, the valid role set is
 * supplied by the caller because it is catalog data this module does not own; whether the recipe,
 * the target, or a value's step exists is the expander's question, since only it can see them.
 */

import {
    RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH,
    RECIPE_EXPANSION_MAX_STEP_INDEX,
    RECIPE_EXPANSION_MAX_TARGET_ID_LENGTH,
    RECIPE_EXPANSION_MAX_VALUES,
} from '../models/RecipeExpansionLimits';

export type RecipeExpansionValue = {
    step: number;
    paramId: string;
    value: number;
};

export type RecipeExpansionInput = {
    recipeId: string;
    targetId: string;
    role: string | null;
    values: readonly RecipeExpansionValue[];
};

type ParsedRecipeExpansionInput =
    { status: 'valid'; input: RecipeExpansionInput } | { status: 'invalid'; reason: string };

const ALLOWED_KEYS = ['recipeId', 'targetId', 'role', 'values'] as const;
const ALLOWED_VALUE_KEYS = ['step', 'paramId', 'value'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function parseValue(entry: unknown): RecipeExpansionValue | null {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ALLOWED_VALUE_KEYS)) {
        return null;
    }
    const { step, paramId, value } = entry;
    if (
        typeof step !== 'number' ||
        !Number.isInteger(step) ||
        step < 0 ||
        step > RECIPE_EXPANSION_MAX_STEP_INDEX ||
        !isBoundedString(paramId, RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH) ||
        typeof value !== 'number' ||
        !Number.isFinite(value)
    ) {
        return null;
    }
    return { step, paramId, value };
}

function parseValues(raw: unknown): readonly RecipeExpansionValue[] | null {
    if (!Array.isArray(raw) || raw.length > RECIPE_EXPANSION_MAX_VALUES) {
        return null;
    }
    const values: RecipeExpansionValue[] = [];
    for (const entry of raw) {
        const parsed = parseValue(entry);
        if (parsed === null) {
            return null;
        }
        values.push(parsed);
    }
    return values;
}

export function parseRecipeExpansionInput(
    argumentsValue: unknown,
    catalogRoles: readonly string[]
): ParsedRecipeExpansionInput {
    if (!isRecord(argumentsValue) || !hasOnlyKeys(argumentsValue, ALLOWED_KEYS)) {
        return { status: 'invalid', reason: 'recipe.expand arguments do not match the strict expansion contract' };
    }
    if (!isBoundedString(argumentsValue.recipeId, RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH)) {
        return { status: 'invalid', reason: 'recipe.expand recipeId must be a bounded non-empty string' };
    }
    if (!isBoundedString(argumentsValue.targetId, RECIPE_EXPANSION_MAX_TARGET_ID_LENGTH)) {
        return { status: 'invalid', reason: 'recipe.expand targetId must be a bounded non-empty string' };
    }
    if (
        argumentsValue.role !== undefined &&
        (typeof argumentsValue.role !== 'string' || !catalogRoles.includes(argumentsValue.role))
    ) {
        return { status: 'invalid', reason: 'recipe.expand role must be one of the catalog roles' };
    }
    const values = argumentsValue.values === undefined ? [] : parseValues(argumentsValue.values);
    if (values === null) {
        return {
            status: 'invalid',
            reason: `recipe.expand values must be at most ${String(RECIPE_EXPANSION_MAX_VALUES)} entries of exactly step, paramId and a finite value`,
        };
    }
    const repeated = values.find(
        (candidate, index) =>
            values.findIndex((other) => other.step === candidate.step && other.paramId === candidate.paramId) !== index
    );
    if (repeated !== undefined) {
        return {
            status: 'invalid',
            reason: `recipe.expand values repeat step ${String(repeated.step)} parameter ${repeated.paramId}`,
        };
    }
    return {
        status: 'valid',
        input: {
            recipeId: argumentsValue.recipeId,
            targetId: argumentsValue.targetId,
            role: typeof argumentsValue.role === 'string' ? argumentsValue.role : null,
            values,
        },
    };
}
