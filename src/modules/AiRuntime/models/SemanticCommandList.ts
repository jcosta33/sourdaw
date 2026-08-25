import { MAX_LLM_ACTIONS_PER_BATCH } from './LlmActionLimits';

export const SEMANTIC_COMMAND_LIST_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_COMMAND_LIST_MAX_ITEMS = 16;
export const SEMANTIC_COMMAND_LIST_MAX_COMMANDS = MAX_LLM_ACTIONS_PER_BATCH;
export const SEMANTIC_COMMAND_LIST_MAX_REPEAT = 8;
export const SEMANTIC_COMMAND_LIST_MAX_JSON_DEPTH = 16;
export const SEMANTIC_COMMAND_LIST_MAX_JSON_NODES = SEMANTIC_COMMAND_LIST_MAX_ITEMS * 256;

export const SEMANTIC_COMMAND_LIST_ENTITIES = [
    'track',
    'clip',
    'device',
    'automation-lane',
    'adjustment-layer',
] as const;

export const SEMANTIC_COMMAND_LIST_CONDITION_FIELDS = ['muted', 'locked', 'bypassed', 'enabled'] as const;

export type SemanticCommandListEntity = (typeof SEMANTIC_COMMAND_LIST_ENTITIES)[number];
export type SemanticCommandListConditionField = (typeof SEMANTIC_COMMAND_LIST_CONDITION_FIELDS)[number];

export type SemanticCommandListSelector = {
    targetArgument: string;
    entity: SemanticCommandListEntity;
    where?: Partial<Record<'name' | 'kind' | 'type' | 'trackId', string>>;
    excludeIds?: string[];
    condition?: { field: SemanticCommandListConditionField; equals: boolean };
    quantity: { unit: 'targets'; exactly: number };
};

export type SemanticCommandListItem = {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    selector?: SemanticCommandListSelector;
    repeat?: { count: number };
    dependsOn?: string[];
};

export type SemanticCommandListV1 = {
    schemaVersion: typeof SEMANTIC_COMMAND_LIST_SCHEMA_VERSION;
    items: SemanticCommandListItem[];
};

const boundedStringSchema = { type: 'string', minLength: 1, maxLength: 256 } as const;

/**
 * The provider-facing and runtime structural contract for semantic command lists.
 * Command arguments remain command-owned and are disclosed through catalog discovery;
 * every semantic-list field and nested enum is closed here.
 */
export const SEMANTIC_COMMAND_LIST_V1_JSON_SCHEMA = {
    type: 'object',
    description:
        'Version 1 bounded semantic command list. Each item names a discovered command and may use one bounded selector, exclusion, condition, exact quantity, dependency set, and local repetition descriptor. Command arguments may reference an earlier declared batch-local binding as $<binding>. The application resolves IDs and guards from one snapshot.',
    properties: {
        schemaVersion: { type: 'integer', enum: [SEMANTIC_COMMAND_LIST_SCHEMA_VERSION] },
        items: {
            type: 'array',
            minItems: 1,
            maxItems: SEMANTIC_COMMAND_LIST_MAX_ITEMS,
            items: {
                type: 'object',
                properties: {
                    id: boundedStringSchema,
                    name: boundedStringSchema,
                    arguments: { type: 'object', additionalProperties: true },
                    selector: {
                        type: 'object',
                        properties: {
                            targetArgument: boundedStringSchema,
                            entity: { type: 'string', enum: SEMANTIC_COMMAND_LIST_ENTITIES },
                            where: {
                                type: 'object',
                                properties: {
                                    name: boundedStringSchema,
                                    kind: boundedStringSchema,
                                    type: boundedStringSchema,
                                    trackId: boundedStringSchema,
                                },
                                additionalProperties: false,
                            },
                            excludeIds: {
                                type: 'array',
                                maxItems: SEMANTIC_COMMAND_LIST_MAX_COMMANDS,
                                uniqueItems: true,
                                items: boundedStringSchema,
                            },
                            condition: {
                                type: 'object',
                                properties: {
                                    field: { type: 'string', enum: SEMANTIC_COMMAND_LIST_CONDITION_FIELDS },
                                    equals: { type: 'boolean' },
                                },
                                required: ['field', 'equals'],
                                additionalProperties: false,
                            },
                            quantity: {
                                type: 'object',
                                properties: {
                                    unit: { type: 'string', enum: ['targets'] },
                                    exactly: {
                                        type: 'integer',
                                        minimum: 1,
                                        maximum: SEMANTIC_COMMAND_LIST_MAX_COMMANDS,
                                    },
                                },
                                required: ['unit', 'exactly'],
                                additionalProperties: false,
                            },
                        },
                        required: ['targetArgument', 'entity', 'quantity'],
                        additionalProperties: false,
                    },
                    repeat: {
                        type: 'object',
                        properties: {
                            count: {
                                type: 'integer',
                                minimum: 1,
                                maximum: SEMANTIC_COMMAND_LIST_MAX_REPEAT,
                            },
                        },
                        required: ['count'],
                        additionalProperties: false,
                    },
                    dependsOn: {
                        type: 'array',
                        maxItems: SEMANTIC_COMMAND_LIST_MAX_ITEMS,
                        uniqueItems: true,
                        items: boundedStringSchema,
                    },
                },
                required: ['id', 'name', 'arguments'],
                additionalProperties: false,
            },
        },
    },
    required: ['schemaVersion', 'items'],
    additionalProperties: false,
} as const;

type SemanticCommandListParseResult =
    { status: 'accepted'; value: SemanticCommandListV1 } | { status: 'rejected'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) {
        return false;
    }
    const prototype = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

type JsonTraversalEntry = { phase: 'enter'; value: unknown; depth: number } | { phase: 'leave'; value: object };

function isBoundedJsonValue(value: unknown): boolean {
    const stack: JsonTraversalEntry[] = [{ phase: 'enter', value, depth: 0 }];
    const ancestors = new WeakSet<object>();
    let visitedNodes = 0;
    let pendingNodes = 1;

    const schedule = (entry: unknown, depth: number): boolean => {
        if (visitedNodes + pendingNodes >= SEMANTIC_COMMAND_LIST_MAX_JSON_NODES) {
            return false;
        }
        stack.push({ phase: 'enter', value: entry, depth });
        pendingNodes += 1;
        return true;
    };

    while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) {
            return false;
        }
        if (current.phase === 'leave') {
            ancestors.delete(current.value);
            continue;
        }

        pendingNodes -= 1;
        visitedNodes += 1;
        if (
            visitedNodes > SEMANTIC_COMMAND_LIST_MAX_JSON_NODES ||
            current.depth > SEMANTIC_COMMAND_LIST_MAX_JSON_DEPTH
        ) {
            return false;
        }

        const currentValue = current.value;
        if (currentValue === null || typeof currentValue === 'string' || typeof currentValue === 'boolean') {
            continue;
        }
        if (typeof currentValue === 'number') {
            if (!Number.isFinite(currentValue)) {
                return false;
            }
            continue;
        }
        if (!Array.isArray(currentValue) && !isPlainRecord(currentValue)) {
            return false;
        }
        if (ancestors.has(currentValue)) {
            return false;
        }

        ancestors.add(currentValue);
        stack.push({ phase: 'leave', value: currentValue });
        if (Array.isArray(currentValue)) {
            if (currentValue.length > SEMANTIC_COMMAND_LIST_MAX_JSON_NODES) {
                return false;
            }
            for (let index = currentValue.length - 1; index >= 0; index -= 1) {
                if (!Object.hasOwn(currentValue, index) || !schedule(currentValue[index], current.depth + 1)) {
                    return false;
                }
            }
            continue;
        }
        for (const key in currentValue) {
            if (Object.hasOwn(currentValue, key) && !schedule(currentValue[key], current.depth + 1)) {
                return false;
            }
        }
    }

    return true;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
    const stack: Array<{ left: unknown; right: unknown; depth: number }> = [{ left, right, depth: 0 }];
    let comparedNodes = 0;

    while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) {
            return false;
        }
        comparedNodes += 1;
        if (
            comparedNodes > SEMANTIC_COMMAND_LIST_MAX_JSON_NODES ||
            current.depth > SEMANTIC_COMMAND_LIST_MAX_JSON_DEPTH
        ) {
            return false;
        }
        if (Object.is(current.left, current.right)) {
            continue;
        }
        if (Array.isArray(current.left) || Array.isArray(current.right)) {
            if (
                !Array.isArray(current.left) ||
                !Array.isArray(current.right) ||
                current.left.length !== current.right.length
            ) {
                return false;
            }
            for (let index = current.left.length - 1; index >= 0; index -= 1) {
                stack.push({ left: current.left[index], right: current.right[index], depth: current.depth + 1 });
            }
            continue;
        }
        if (isRecord(current.left) || isRecord(current.right)) {
            if (!isRecord(current.left) || !isRecord(current.right)) {
                return false;
            }
            const leftKeys = Object.keys(current.left);
            const rightKeys = Object.keys(current.right);
            if (leftKeys.length !== rightKeys.length) {
                return false;
            }
            for (const key of leftKeys) {
                if (!Object.hasOwn(current.right, key)) {
                    return false;
                }
                stack.push({ left: current.left[key], right: current.right[key], depth: current.depth + 1 });
            }
            continue;
        }
        return false;
    }

    return true;
}

function matchesType(value: unknown, type: unknown): boolean {
    if (type === 'object') {
        return isRecord(value);
    }
    if (type === 'array') {
        return Array.isArray(value);
    }
    if (type === 'integer') {
        return typeof value === 'number' && Number.isInteger(value);
    }
    return typeof type === 'string' && typeof value === type;
}

function matchesSchema(value: unknown, schema: unknown, depth = 0): boolean {
    if (depth > SEMANTIC_COMMAND_LIST_MAX_JSON_DEPTH || !isRecord(schema)) {
        return false;
    }
    if (schema.type !== undefined && !matchesType(value, schema.type)) {
        return false;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonValuesEqual(entry, value))) {
        return false;
    }
    if (typeof value === 'string') {
        if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
            return false;
        }
        if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
            return false;
        }
    }
    if (typeof value === 'number') {
        if (typeof schema.minimum === 'number' && value < schema.minimum) {
            return false;
        }
        if (typeof schema.maximum === 'number' && value > schema.maximum) {
            return false;
        }
    }
    if (Array.isArray(value)) {
        if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
            return false;
        }
        if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
            return false;
        }
        if (
            schema.uniqueItems === true &&
            value.some((entry, index) =>
                value.some((candidate, candidateIndex) => candidateIndex > index && jsonValuesEqual(entry, candidate))
            )
        ) {
            return false;
        }
        if (schema.items !== undefined && !value.every((entry) => matchesSchema(entry, schema.items, depth + 1))) {
            return false;
        }
    }
    if (isRecord(value)) {
        const properties = isRecord(schema.properties) ? schema.properties : {};
        if (
            Array.isArray(schema.required) &&
            schema.required.some((required) => typeof required !== 'string' || !(required in value))
        ) {
            return false;
        }
        for (const [key, entry] of Object.entries(value)) {
            if (key in properties) {
                if (!matchesSchema(entry, properties[key], depth + 1)) {
                    return false;
                }
                continue;
            }
            if (schema.additionalProperties === false) {
                return false;
            }
            if (
                isRecord(schema.additionalProperties) &&
                !matchesSchema(entry, schema.additionalProperties, depth + 1)
            ) {
                return false;
            }
        }
    }
    return true;
}

/** Parses only the closed structural grammar; command ownership and composition remain compiler checks. */
export function parseSemanticCommandList(value: unknown): SemanticCommandListParseResult {
    try {
        if (!isBoundedJsonValue(value) || !matchesSchema(value, SEMANTIC_COMMAND_LIST_V1_JSON_SCHEMA)) {
            return {
                status: 'rejected',
                reason: 'Structured command list does not match the versioned application contract.',
            };
        }
        return { status: 'accepted', value: structuredClone(value) as SemanticCommandListV1 };
    } catch {
        return {
            status: 'rejected',
            reason: 'Structured command list does not match the versioned application contract.',
        };
    }
}
