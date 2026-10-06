type CompactableTool = {
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

type SchemaRecord = Record<string, unknown>;

/**
 * Levels of nested `properties` and `items` the local prompt spells out. It must reach the deepest
 * required property, `required` list, enum, const or combinator branch of every planning tool's
 * schema: a node past it keeps only its type, enum and description, and a selector written without
 * its `quantity.unit` is refused. The compaction spec walks each full schema to hold that.
 */
const MAX_SCHEMA_DEPTH = 8;

/**
 * Keywords that annotate a value without telling the model anything the description does not. A
 * description is content, not annotation: a unit, a range or an "exactly one of" rule lives in it,
 * and a handler that admits a value outside it edits the project with no receipt. Every description
 * stays, and every keyword that decides which values validate stays, because the reply is checked
 * against the full schema and a call the compacted text admits but that schema refuses fails the
 * whole provider attempt.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set(['title', 'examples', 'default']);

const COMBINATOR_KEYWORDS: ReadonlySet<string> = new Set(['anyOf', 'oneOf', 'allOf']);

/** A repeated sub-schema shorter than this costs about as much as the reference to it. */
const MIN_DEFINITION_LENGTH = 36;
const MAX_DEFINITIONS = 16;
const DEFINITIONS_KEYWORD = '$defs';

function isRecord(value: unknown): value is SchemaRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collapseSchema(schema: SchemaRecord): SchemaRecord {
    const collapsed: SchemaRecord = {};
    for (const keyword of ['type', 'enum', 'description']) {
        if (schema[keyword] !== undefined) {
            collapsed[keyword] = schema[keyword];
        }
    }
    return collapsed;
}

/**
 * The one `type` that says nothing its sibling does not: a string type on a node whose `enum` lists
 * only strings, because the enum already admits those strings and no other value. Every other type
 * stays. `properties` is ignored for a value that is not an object and `items` for one that is not
 * an array, so an object or array type is what refuses a string where an object belongs.
 */
function isImpliedType(schema: SchemaRecord, keyword: string): boolean {
    return (
        keyword === 'type' &&
        schema.type === 'string' &&
        Array.isArray(schema.enum) &&
        schema.enum.every((value) => typeof value === 'string')
    );
}

function compactSchema(schema: unknown, depth: number): unknown {
    if (!isRecord(schema)) {
        return schema;
    }
    if (depth > MAX_SCHEMA_DEPTH) {
        return collapseSchema(schema);
    }
    const compacted: SchemaRecord = {};
    for (const [keyword, value] of Object.entries(schema)) {
        if (ANNOTATION_KEYWORDS.has(keyword) || isImpliedType(schema, keyword)) {
            continue;
        }
        if (keyword === 'properties' && isRecord(value)) {
            compacted.properties = Object.fromEntries(
                Object.entries(value).map(([name, property]) => [name, compactSchema(property, depth + 1)])
            );
        } else if (keyword === 'items') {
            compacted.items = compactSchema(value, depth + 1);
        } else if (COMBINATOR_KEYWORDS.has(keyword) && Array.isArray(value)) {
            compacted[keyword] = value.map((branch) => compactSchema(branch, depth + 1));
        } else {
            compacted[keyword] = value;
        }
    }
    return compacted;
}

function countRepeated(node: unknown, counts: Map<string, number>): void {
    if (Array.isArray(node)) {
        for (const child of node) {
            countRepeated(child, counts);
        }
        return;
    }
    if (!isRecord(node)) {
        return;
    }
    const key = JSON.stringify(node);
    if (key.length >= MIN_DEFINITION_LENGTH) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const child of Object.values(node)) {
        countRepeated(child, counts);
    }
}

function replaceRepeated(node: unknown, key: string, reference: SchemaRecord): unknown {
    if (Array.isArray(node)) {
        return node.map((child) => replaceRepeated(child, key, reference));
    }
    if (!isRecord(node)) {
        return node;
    }
    if (JSON.stringify(node) === key) {
        return reference;
    }
    return Object.fromEntries(
        Object.entries(node).map(([keyword, child]) => [keyword, replaceRepeated(child, key, reference)])
    );
}

/**
 * Moves a sub-schema the tool repeats into one named definition the prompt shows once, the way a
 * schema author would, so the repeated text costs a reference each time. It picks the repeat that
 * saves the most, then looks again, because replacing one repeat can expose another.
 */
function defineRepeated(parameters: SchemaRecord): SchemaRecord {
    let tree = parameters;
    const definitions: SchemaRecord = {};
    for (let index = 1; index <= MAX_DEFINITIONS; index += 1) {
        const counts = new Map<string, number>();
        countRepeated(tree, counts);
        const reference = { $ref: `#/${DEFINITIONS_KEYWORD}/d${String(index)}` };
        const referenceLength = JSON.stringify(reference).length;
        let best: { key: string; saving: number } | null = null;
        for (const [key, count] of counts) {
            const saving = (key.length - referenceLength) * count - key.length;
            if (count >= 2 && saving > 0 && (best === null || saving > best.saving)) {
                best = { key, saving };
            }
        }
        if (best === null) {
            break;
        }
        const replaced = replaceRepeated(tree, best.key, reference);
        if (!isRecord(replaced)) {
            break;
        }
        definitions[`d${String(index)}`] = JSON.parse(best.key);
        tree = replaced;
    }
    return Object.keys(definitions).length === 0 ? tree : { ...tree, [DEFINITIONS_KEYWORD]: definitions };
}

function compactParameters(parameters: SchemaRecord): SchemaRecord {
    const compacted = compactSchema(parameters, 0);
    return isRecord(compacted) ? defineRepeated(compacted) : parameters;
}

/**
 * The tool as the local model's prompt spells it. The compaction is structural and lossless for text
 * and for validity: every description, tool and property, is kept word for word, and so is every
 * keyword that decides which values validate. What goes is what the model gains nothing from: titles,
 * examples, defaults, the string type of an all-string enum, and a sub-schema repeated within the
 * tool, which is defined once and referenced.
 */
export function compactWebLlmToolSchema(tool: CompactableTool): CompactableTool {
    const { parameters } = tool.function;
    const compactedParameters = parameters === undefined ? {} : { parameters: compactParameters(parameters) };
    return { ...tool, function: { ...tool.function, ...compactedParameters } };
}
