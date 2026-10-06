import {
    ANALYSIS_MEASURE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    MANDATORY_PLANNING_TOOL_NAMES,
    TRANSFORM_COMPILE_TOOL_NAME,
} from '../models/AgentToolCatalogNames';

type CompactableTool = {
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

type SchemaRecord = Record<string, unknown>;

/** The longest description the local model's prompt carries for a tool that is not a mandatory planning tool. */
const MAX_DESCRIPTION_LENGTH = 120;

/**
 * Levels of nested `properties` and `items` the local prompt spells out. It must reach the deepest
 * required property, `required` list, enum, const or combinator branch of every mandatory tool's
 * schema: a node past it keeps only its type and enum, and a selector written without its
 * `quantity.unit` is refused. The compaction spec walks each full schema to hold that.
 */
const MAX_SCHEMA_DEPTH = 8;

/**
 * Keywords that annotate a value without changing which values validate. Every bound and closure
 * keyword stays: the reply is checked against the full schema, and a call the compacted text admits
 * but the full schema refuses fails the whole provider attempt with no receipt back to the model.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set(['description', 'title', 'examples', 'default']);

/**
 * A property whose schema is another tool's argument, replaced in the prompt by a pointer to it. The
 * pointer is the property's description, because the prompt keeps no other text for a property.
 */
const REFERENCED_PROPERTIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    [ANALYSIS_MEASURE_TOOL_NAME]: {
        proposal: `The same object ${COMMAND_BATCH_PROPOSAL_TOOL_NAME} takes as its list argument.`,
    },
};

/** A property that is one JSON string whose description is its whole grammar, so the description stays. */
const GRAMMAR_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
    [TRANSFORM_COMPILE_TOOL_NAME]: ['document'],
};

const SELECTOR_PATH = ['properties', 'list', 'properties', 'items', 'items', 'properties', 'selector'] as const;

/**
 * Rules the full schema states only in a description the prompt drops, written onto the node they
 * govern: the schema cannot express "exactly one of", so the application refuses a node that breaks
 * it after the model has already written it.
 */
const NODE_NOTES: Readonly<Record<string, readonly { path: readonly string[]; note: string }[]>> = {
    [COMMAND_BATCH_PROPOSAL_TOOL_NAME]: [
        { path: [...SELECTOR_PATH, 'properties', 'quantity'], note: 'Name exactly one of exactly or maximum.' },
        {
            path: [...SELECTOR_PATH, 'properties', 'match', 'properties', 'all', 'items'],
            note: 'Name exactly one field.',
        },
        {
            path: [...SELECTOR_PATH, 'properties', 'match', 'properties', 'any', 'items'],
            note: 'Name exactly one field.',
        },
    ],
};

const COMBINATOR_KEYWORDS: ReadonlySet<string> = new Set(['anyOf', 'oneOf', 'allOf']);

/** A repeated sub-schema shorter than this costs about as much as the reference to it. */
const MIN_DEFINITION_LENGTH = 36;
const MAX_DEFINITIONS = 16;
const DEFINITIONS_KEYWORD = '$defs';

function isRecord(value: unknown): value is SchemaRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitSentences(description: string): string[] {
    return description.split(/(?<=[.!?])\s+/);
}

function truncate(sentence: string): string {
    return sentence.length > MAX_DESCRIPTION_LENGTH ? `${sentence.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…` : sentence;
}

/**
 * A mandatory planning tool's description is its contract: how to call it alone, which returned id to
 * pass on, what refuses it. Which sentence carries a rule differs by tool and has been wrong every time
 * it was picked by position, so those eight keep their description whole. Any other tool is a name and
 * the first sentence of what it does.
 */
function describeTool(toolName: string, description: string): string {
    if ((MANDATORY_PLANNING_TOOL_NAMES as readonly string[]).includes(toolName)) {
        return description;
    }
    return truncate(splitSentences(description)[0] ?? description);
}

function collapseSchema(schema: SchemaRecord): SchemaRecord {
    const collapsed: SchemaRecord = {};
    if (schema.type !== undefined) {
        collapsed.type = schema.type;
    }
    if (schema.enum !== undefined) {
        collapsed.enum = schema.enum;
    }
    return collapsed;
}

/**
 * A nested node that lists `properties` is an object, one that lists `items` is an array, and one
 * that lists string `enum` values is a string; the root keeps its type for the model to read first.
 */
function isImpliedType(schema: SchemaRecord, keyword: string, depth: number): boolean {
    if (depth === 0 || keyword !== 'type') {
        return false;
    }
    if (schema.type === 'object') {
        return isRecord(schema.properties);
    }
    if (schema.type === 'array') {
        return isRecord(schema.items);
    }
    return (
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
        if (ANNOTATION_KEYWORDS.has(keyword) || isImpliedType(schema, keyword, depth)) {
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

/**
 * The grammar a description states, without the numeric limits sentence (the application enforces
 * them and refuses with a receipt) and without the worked example that closes it.
 */
function grammarOnly(description: string): string {
    return splitSentences(description)
        .slice(0, -1)
        .filter((sentence) => !sentence.startsWith('Limits:'))
        .join(' ');
}

function keepGrammarDescription(original: unknown, compacted: unknown): unknown {
    const description = isRecord(original) ? original.description : undefined;
    if (typeof description !== 'string' || !isRecord(compacted)) {
        return compacted;
    }
    return { ...compacted, description: grammarOnly(description) };
}

function compactProperties(toolName: string, parameters: SchemaRecord, properties: SchemaRecord): SchemaRecord {
    const referenced = REFERENCED_PROPERTIES[toolName] ?? {};
    const grammar = GRAMMAR_PROPERTIES[toolName] ?? [];
    const originalProperties = isRecord(parameters.properties) ? parameters.properties : {};
    return Object.fromEntries(
        Object.entries(properties).map(([name, property]) => {
            const pointer = referenced[name];
            if (pointer !== undefined) {
                return [name, { type: 'object', description: pointer }];
            }
            return [
                name,
                grammar.includes(name) ? keepGrammarDescription(originalProperties[name], property) : property,
            ];
        })
    );
}

/** `path` steps through `properties`, a property name, and `items`, as the schema nests them. */
function writeNote(node: unknown, path: readonly string[], note: string): unknown {
    if (!isRecord(node)) {
        return node;
    }
    const [step, ...rest] = path;
    if (step === undefined) {
        return { ...node, description: note };
    }
    if (step === 'items') {
        return { ...node, items: writeNote(node.items, rest, note) };
    }
    const [name, ...tail] = rest;
    if (step !== 'properties' || name === undefined || !isRecord(node.properties)) {
        return node;
    }
    return { ...node, properties: { ...node.properties, [name]: writeNote(node.properties[name], tail, note) } };
}

function writeNodeNotes(toolName: string, parameters: SchemaRecord): SchemaRecord {
    let annotated: unknown = parameters;
    for (const { path, note } of NODE_NOTES[toolName] ?? []) {
        annotated = writeNote(annotated, path, note);
    }
    return isRecord(annotated) ? annotated : parameters;
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

function compactParameters(toolName: string, parameters: SchemaRecord): SchemaRecord {
    const compacted = compactSchema(parameters, 0);
    if (!isRecord(compacted)) {
        return parameters;
    }
    if (!isRecord(compacted.properties)) {
        return defineRepeated(writeNodeNotes(toolName, compacted));
    }
    const withProperties = { ...compacted, properties: compactProperties(toolName, parameters, compacted.properties) };
    return defineRepeated(writeNodeNotes(toolName, withProperties));
}

/**
 * The tool as the local model's prompt spells it. WebLLM serializes every advertised tool into the
 * system prompt, and the mandatory planning set no longer fits that window at full size, so the
 * prompt carries the first sentence of each description and the shape of each argument without its
 * annotations. Every keyword that decides which values validate stays, because the request that
 * checks the model's reply uses the full schema and refuses what the compacted text admits.
 */
export function compactWebLlmToolSchema(tool: CompactableTool): CompactableTool {
    const { description, parameters, ...identity } = tool.function;
    const compactedDescription =
        description === undefined ? {} : { description: describeTool(tool.function.name, description) };
    const compactedParameters =
        parameters === undefined ? {} : { parameters: compactParameters(tool.function.name, parameters) };
    return { ...tool, function: { ...identity, ...compactedDescription, ...compactedParameters } };
}
