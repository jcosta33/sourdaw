function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown, depth = 0): boolean {
    if (depth > 64) {
        return false;
    }
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every((item) => isJsonValue(item, depth + 1));
    }
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

function matchesSchemaType(value: unknown, type: unknown): boolean {
    if (Array.isArray(type)) {
        return type.some((entry) => matchesSchemaType(value, entry));
    }
    if (type === 'null') {
        return value === null;
    }
    if (type === 'object') {
        return isRecord(value);
    }
    if (type === 'array') {
        return Array.isArray(value);
    }
    if (type === 'string') {
        return typeof value === 'string';
    }
    if (type === 'boolean') {
        return typeof value === 'boolean';
    }
    if (type === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
    }
    if (type === 'integer') {
        return typeof value === 'number' && Number.isSafeInteger(value);
    }
    return false;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((item, index) => jsonValuesEqual(item, right[index]));
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

function matchesCompositions(value: unknown, schema: Record<string, unknown>, depth: number): boolean {
    if (
        Array.isArray(schema.oneOf) &&
        schema.oneOf.filter((member) => matchesJsonSchema(value, member, depth + 1)).length !== 1
    ) {
        return false;
    }
    if (Array.isArray(schema.anyOf) && !schema.anyOf.some((member) => matchesJsonSchema(value, member, depth + 1))) {
        return false;
    }
    if (Array.isArray(schema.allOf) && !schema.allOf.every((member) => matchesJsonSchema(value, member, depth + 1))) {
        return false;
    }
    if (schema.not !== undefined && matchesJsonSchema(value, schema.not, depth + 1)) {
        return false;
    }
    if ('const' in schema && !jsonValuesEqual(value, schema.const)) {
        return false;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonValuesEqual(entry, value))) {
        return false;
    }
    if (schema.type !== undefined && !matchesSchemaType(value, schema.type)) {
        return false;
    }
    return true;
}

function matchesStringConstraints(value: string, schema: Record<string, unknown>): boolean {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
        return false;
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
        return false;
    }
    if (typeof schema.pattern === 'string') {
        try {
            return new RegExp(schema.pattern, 'u').test(value);
        } catch {
            return false;
        }
    }
    return true;
}

function matchesNumberConstraints(value: number, schema: Record<string, unknown>): boolean {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
        return false;
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
        return false;
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
        return false;
    }
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) {
        return false;
    }
    return true;
}

function matchesArrayConstraints(value: unknown[], schema: Record<string, unknown>, depth: number): boolean {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
        return false;
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
        return false;
    }
    if (
        schema.uniqueItems === true &&
        value.some((item, index) => value.slice(index + 1).some((candidate) => jsonValuesEqual(item, candidate)))
    ) {
        return false;
    }
    return schema.items === undefined || value.every((item) => matchesJsonSchema(item, schema.items, depth + 1));
}

function matchesObjectConstraints(
    value: Record<string, unknown>,
    schema: Record<string, unknown>,
    depth: number
): boolean {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
        for (const required of schema.required) {
            if (typeof required !== 'string' || !(required in value)) {
                return false;
            }
        }
    }
    for (const [key, item] of Object.entries(value)) {
        if (key in properties) {
            if (!matchesJsonSchema(item, properties[key], depth + 1)) {
                return false;
            }
            continue;
        }
        if (schema.additionalProperties === false) {
            return false;
        }
        if (isRecord(schema.additionalProperties) || typeof schema.additionalProperties === 'boolean') {
            if (!matchesJsonSchema(item, schema.additionalProperties, depth + 1)) {
                return false;
            }
        }
    }
    return true;
}

export function matchesJsonSchema(value: unknown, schema: unknown, depth = 0): boolean {
    if (depth > 64) {
        return false;
    }
    if (typeof schema === 'boolean') {
        return schema;
    }
    if (!isRecord(schema) || !isJsonValue(value) || !matchesCompositions(value, schema, depth)) {
        return false;
    }
    if (typeof value === 'string') {
        return matchesStringConstraints(value, schema);
    }
    if (typeof value === 'number') {
        return matchesNumberConstraints(value, schema);
    }
    if (Array.isArray(value)) {
        return matchesArrayConstraints(value, schema, depth);
    }
    return !isRecord(value) || matchesObjectConstraints(value, schema, depth);
}

/** Where a value first leaves its schema, as the property names and item indices leading there. */
export type JsonSchemaViolation = {
    kind: 'missing-property' | 'undeclared-property' | 'invalid-value';
    path: readonly (string | number)[];
};

function locateObjectViolation(
    value: Record<string, unknown>,
    schema: Record<string, unknown>,
    path: readonly (string | number)[],
    depth: number
): JsonSchemaViolation | null {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
        const missing = schema.required.find((required) => typeof required !== 'string' || !(required in value));
        if (missing !== undefined) {
            return { kind: 'missing-property', path: typeof missing === 'string' ? [...path, missing] : path };
        }
    }
    for (const [key, item] of Object.entries(value)) {
        if (key in properties) {
            if (!matchesJsonSchema(item, properties[key], depth + 1)) {
                return locateJsonSchemaViolation(item, properties[key], [...path, key], depth + 1);
            }
            continue;
        }
        if (schema.additionalProperties === false) {
            return { kind: 'undeclared-property', path: [...path, key] };
        }
        if (
            (isRecord(schema.additionalProperties) || typeof schema.additionalProperties === 'boolean') &&
            !matchesJsonSchema(item, schema.additionalProperties, depth + 1)
        ) {
            return locateJsonSchemaViolation(item, schema.additionalProperties, [...path, key], depth + 1);
        }
    }
    return null;
}

/**
 * Descends only where one sub-schema alone decides the failure — a declared property, an
 * additional property, an array item — and otherwise names the value itself, so a failed
 * composition or a scalar constraint is reported where it applies rather than guessed into a branch.
 */
function locateJsonSchemaViolation(
    value: unknown,
    schema: unknown,
    path: readonly (string | number)[],
    depth: number
): JsonSchemaViolation {
    const here: JsonSchemaViolation = { kind: 'invalid-value', path };
    if (depth > 64 || !isRecord(schema) || !isJsonValue(value) || !matchesCompositions(value, schema, depth)) {
        return here;
    }
    if (isRecord(value)) {
        return locateObjectViolation(value, schema, path, depth) ?? here;
    }
    if (Array.isArray(value) && schema.items !== undefined) {
        const index = value.findIndex((item) => !matchesJsonSchema(item, schema.items, depth + 1));
        if (index >= 0) {
            return locateJsonSchemaViolation(value[index], schema.items, [...path, index], depth + 1);
        }
    }
    return here;
}

/** The first place `value` leaves `schema`, or null when it matches. */
export function findJsonSchemaViolation(value: unknown, schema: unknown): JsonSchemaViolation | null {
    return matchesJsonSchema(value, schema) ? null : locateJsonSchemaViolation(value, schema, [], 0);
}
