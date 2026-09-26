import { ToolSchemaProjectionError } from './ToolSchemaProjectionError';

/**
 * Keywords both hosted strict-schema dialects drop: Anthropic's structured-output
 * subset never accepted them, and Sourdaw keeps every numeric or string bound in
 * `validateActionPayload.ts` — one source of truth the wire schema never duplicates.
 * `maxItems` and `uniqueItems` join this list; `minItems` gets its own clamp below
 * instead, since a value of 0 or 1 survives unstripped.
 *
 * Live-doc-verified 2026-09-18:
 * - Anthropic (`platform.claude.com/docs/en/build-with-claude/structured-outputs`,
 *   "Not supported"): "Array constraints beyond `minItems` of 0 or 1" — this covers
 *   both `maxItems` and `uniqueItems`; `minItems` itself is separately documented as
 *   "only values 0 and 1 supported".
 * - OpenAI (`developers.openai.com/api/docs/guides/structured-outputs`, "Supported
 *   array properties"): only `minItems` and `maxItems` are listed as supported array
 *   keywords — `uniqueItems` never appears in the supported list, so it 400s under
 *   `strict: true`. `minItems`/`maxItems` are supported for the models Sourdaw calls;
 *   the doc's "For fine-tuned models, we additionally do not support... `minItems`,
 *   `maxItems`" carve-out does not apply, since Sourdaw never calls a fine-tuned
 *   model. `minItems` therefore needs no OpenAI-specific stripping: the existing
 *   0/1 clamp below, written for Anthropic, is a stricter-than-required but
 *   harmless no-op for OpenAI's wider support.
 */
const STRIPPED_BOUND_KEYWORDS = [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'pattern',
    'format',
    'maxItems',
    'uniqueItems',
] as const;

const STRIPPED_BOUND_KEYWORD_SET = new Set<string>(STRIPPED_BOUND_KEYWORDS);

/**
 * The only keywords `walkSchemaNode` forwards to a strict wire schema unchanged,
 * beside the keys it already rewrites or strips (bounds above, `properties`,
 * `required`, `additionalProperties`, `minItems`, `items`, `oneOf`, `anyOf`,
 * `allOf`, `$ref`). Both hosted dialects' live docs list `type`, `description`,
 * `enum`, and `const` as supported, and the production tool catalog carries no
 * other schema-node keyword (keyword inventory read against every registered tool
 * schema, 2026-09-26). Anything else — `not`, `dependentRequired`,
 * `dependentSchemas`, `if`/`then`/`else`, and any keyword neither dialect documents
 * as supported — must not reach the wire silently: `projectOpenAiStrictToolSchema`'s
 * own doc comment already names that same unsupported set. Add a keyword here only
 * once both providers' live docs list it as supported, with a citation.
 */
const FORWARDED_KEYWORDS = new Set(['type', 'description', 'enum', 'const']);

export type ToolSchemaProjectionMode = {
    /** OpenAI strict mode requires every property in `required`; Anthropic leaves optional properties optional. */
    forceAllRequired: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function pathString(path: readonly string[]): string {
    return path.join('.');
}

function isObjectSchemaNode(node: Record<string, unknown>): boolean {
    return node.type === 'object' || isRecord(node.properties);
}

function describeBound(label: string, value: unknown): string {
    return `${label}: ${JSON.stringify(value)}.`;
}

/** Reads the bounds a stripped keyword carried, off the untouched source node. */
function collectBoundsDescriptionParts(node: Record<string, unknown>): string[] {
    const parts: string[] = [];
    const hasMinimum = 'minimum' in node;
    const hasMaximum = 'maximum' in node;
    if (hasMinimum && hasMaximum) {
        parts.push(`Range: ${JSON.stringify(node.minimum)} to ${JSON.stringify(node.maximum)}.`);
    } else if (hasMinimum) {
        parts.push(describeBound('Minimum', node.minimum));
    } else if (hasMaximum) {
        parts.push(describeBound('Maximum', node.maximum));
    }
    if ('exclusiveMinimum' in node) {
        parts.push(describeBound('Exclusive minimum', node.exclusiveMinimum));
    }
    if ('exclusiveMaximum' in node) {
        parts.push(describeBound('Exclusive maximum', node.exclusiveMaximum));
    }
    if ('multipleOf' in node) {
        parts.push(describeBound('Multiple of', node.multipleOf));
    }
    if ('minLength' in node) {
        parts.push(describeBound('Minimum length', node.minLength));
    }
    if ('maxLength' in node) {
        parts.push(describeBound('Maximum length', node.maxLength));
    }
    if ('pattern' in node) {
        parts.push(describeBound('Pattern', node.pattern));
    }
    if ('format' in node) {
        parts.push(describeBound('Format', node.format));
    }
    if (typeof node.minItems === 'number' && node.minItems > 1) {
        parts.push(describeBound('Minimum items', node.minItems));
    }
    if ('maxItems' in node) {
        parts.push(describeBound('Maximum items', node.maxItems));
    }
    if (node.uniqueItems === true) {
        parts.push('Items must be unique.');
    }
    return parts;
}

function withBoundsDescription(
    sourceNode: Record<string, unknown>,
    projectedNode: Record<string, unknown>
): Record<string, unknown> {
    const boundsParts = collectBoundsDescriptionParts(sourceNode);
    if (boundsParts.length === 0) {
        return projectedNode;
    }
    const description = typeof sourceNode.description === 'string' ? sourceNode.description : undefined;
    const nextDescription = [description, ...boundsParts].filter((part): part is string => Boolean(part)).join(' ');
    return { ...projectedNode, description: nextDescription };
}

/**
 * Wraps a walked (already-projected) child schema so a `null` value satisfies it,
 * for an OpenAI strict-mode property that was optional in the source schema. A
 * schema with a plain `type` widens that field to include `'null'`; anything else
 * (an `enum`-only schema, an `anyOf`, a `const`) is wrapped in an `anyOf` alongside
 * a `{ type: 'null' }` branch instead, per the OpenAI strict-mode nullable pattern.
 */
function makeNullable(walkedChild: unknown): unknown {
    if (!isRecord(walkedChild)) {
        return { anyOf: [walkedChild, { type: 'null' }], description: 'Null when not applicable.' };
    }
    const description = typeof walkedChild.description === 'string' ? walkedChild.description : undefined;
    const nextDescription = description ? `${description} Null when not applicable.` : 'Null when not applicable.';
    if (typeof walkedChild.type === 'string') {
        return { ...walkedChild, type: [walkedChild.type, 'null'], description: nextDescription };
    }
    if (isStringArray(walkedChild.type)) {
        const types = walkedChild.type.includes('null') ? walkedChild.type : [...walkedChild.type, 'null'];
        return { ...walkedChild, type: types, description: nextDescription };
    }
    return { anyOf: [walkedChild, { type: 'null' }], description: nextDescription };
}

function walkChildSchema(value: unknown, path: readonly string[], mode: ToolSchemaProjectionMode): unknown {
    if (!isRecord(value)) {
        // A boolean JSON-schema value (`true`/`false`) or malformed entry carries no
        // bound to strip and no properties to force; pass it through unchanged.
        return value;
    }
    return walkSchemaNode(value, path, mode);
}

function walkComposedBranch(
    key: 'anyOf' | 'oneOf' | 'allOf',
    node: Record<string, unknown>,
    path: readonly string[],
    mode: ToolSchemaProjectionMode
): unknown {
    const branches = node[key];
    if (!Array.isArray(branches)) {
        return branches;
    }
    return branches.map((member, index) => walkChildSchema(member, [...path, `${key}[${String(index)}]`], mode));
}

function walkObjectMembers(
    node: Record<string, unknown>,
    path: readonly string[],
    mode: ToolSchemaProjectionMode
): { properties: Record<string, unknown>; required: string[] } {
    const properties = isRecord(node.properties) ? node.properties : {};
    const originalRequired = isStringArray(node.required) ? node.required : [];
    const originalRequiredSet = new Set(originalRequired);
    const nextProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
        const walked = walkChildSchema(value, [...path, 'properties', key], mode);
        const wasRequired = originalRequiredSet.has(key);
        nextProperties[key] = mode.forceAllRequired && !wasRequired ? makeNullable(walked) : walked;
    }
    return {
        properties: nextProperties,
        required: mode.forceAllRequired ? Object.keys(properties) : originalRequired,
    };
}

/**
 * Projects one JSON-schema node into the bound-free, `additionalProperties: false`
 * shape a strict hosted tool call requires. Reads every field off `node` and
 * `path`; it never mutates either, so the same source schema can be projected for
 * more than one provider.
 */
export function walkSchemaNode(
    node: Record<string, unknown>,
    path: readonly string[],
    mode: ToolSchemaProjectionMode
): Record<string, unknown> {
    if (typeof node.$ref === 'string') {
        throw new ToolSchemaProjectionError(
            pathString(path),
            'a $ref cannot be projected without a schema registry to resolve it'
        );
    }

    const projected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
        if (
            STRIPPED_BOUND_KEYWORD_SET.has(key) ||
            key === 'properties' ||
            key === 'required' ||
            key === 'additionalProperties'
        ) {
            continue;
        }
        if (key === 'minItems') {
            projected.minItems = typeof value === 'number' && value > 1 ? 1 : value;
            continue;
        }
        if (key === 'items') {
            projected.items = walkChildSchema(value, [...path, 'items'], mode);
            continue;
        }
        if (key === 'oneOf') {
            // Neither dialect documents `oneOf` as a supported composition keyword (Anthropic
            // lists only `anyOf`/`allOf`; OpenAI's supported-types list stops at `anyOf`), so a
            // `oneOf` branch set is rewritten onto `anyOf` — same branches, same "exactly one
            // must match" intent collapsed to "any may match", which both dialects already
            // constrain structurally through each branch's own required/type shape.
            projected.anyOf = walkComposedBranch('oneOf', node, path, mode);
            continue;
        }
        if (key === 'anyOf' || key === 'allOf') {
            projected[key] = walkComposedBranch(key, node, path, mode);
            continue;
        }
        if (FORWARDED_KEYWORDS.has(key)) {
            projected[key] = value;
            continue;
        }
        throw new ToolSchemaProjectionError(
            pathString(path),
            `keyword "${key}" is not supported by either hosted strict-schema dialect and cannot be forwarded`
        );
    }

    if (isObjectSchemaNode(node)) {
        const { properties, required } = walkObjectMembers(node, path, mode);
        projected.properties = properties;
        projected.required = required;
        projected.additionalProperties = false;
    }

    return withBoundsDescription(node, projected);
}
