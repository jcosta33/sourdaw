export const SEMANTIC_COMMAND_LIST_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_COMMAND_LIST_MAX_ITEMS = 16;
export const SEMANTIC_COMMAND_LIST_MAX_COMMANDS = 32;
export const SEMANTIC_COMMAND_LIST_MAX_REPEAT = 8;

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

function isJsonValue(value: unknown): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonValue);
    }
    return isRecord(value) && Object.values(value).every(isJsonValue);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((entry, index) => jsonValuesEqual(entry, right[index]));
    }
    if (isRecord(left) && isRecord(right)) {
        const leftKeys = Object.keys(left).sort();
        const rightKeys = Object.keys(right).sort();
        return (
            leftKeys.length === rightKeys.length &&
            leftKeys.every((key, index) => key === rightKeys[index] && jsonValuesEqual(left[key], right[key]))
        );
    }
    return false;
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
    if (depth > 16 || !isRecord(schema) || !isJsonValue(value)) {
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
            value.some((entry, index) => value.slice(index + 1).some((candidate) => jsonValuesEqual(entry, candidate)))
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
    if (!matchesSchema(value, SEMANTIC_COMMAND_LIST_V1_JSON_SCHEMA)) {
        return {
            status: 'rejected',
            reason: 'Structured command list does not match the versioned application contract.',
        };
    }
    return { status: 'accepted', value: structuredClone(value) as SemanticCommandListV1 };
}
