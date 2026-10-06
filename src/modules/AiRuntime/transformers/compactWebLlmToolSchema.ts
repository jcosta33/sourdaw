import { ANALYSIS_MEASURE_TOOL_NAME, TRANSFORM_COMPILE_TOOL_NAME } from '../models/AgentToolCatalogNames';

type CompactableTool = {
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

type SchemaRecord = Record<string, unknown>;

/** The longest tool description the local model's prompt carries; the first sentence is the contract. */
const MAX_DESCRIPTION_LENGTH = 200;

/**
 * Levels of nested `properties` and `items` the local prompt spells out. A deeper node keeps its
 * type and enum only: its fields are validated by the application, and a command's own arguments
 * are disclosed by catalog discovery rather than by the proposal schema.
 */
const MAX_SCHEMA_DEPTH = 4;

/** Keywords that bound or annotate a value without changing which shape the model must write. */
const PROMPT_ONLY_DROPPED_KEYWORDS: ReadonlySet<string> = new Set([
    'description',
    'additionalProperties',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'uniqueItems',
    'pattern',
    'format',
]);

/** A property whose schema duplicates another tool's, which the tool's own description already names. */
const REFERENCED_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
    [ANALYSIS_MEASURE_TOOL_NAME]: ['proposal'],
};

/** A property that is one JSON string whose description is its whole grammar, so the description stays. */
const GRAMMAR_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
    [TRANSFORM_COMPILE_TOOL_NAME]: ['document'],
};

const COMBINATOR_KEYWORDS: ReadonlySet<string> = new Set(['anyOf', 'oneOf', 'allOf']);

function isRecord(value: unknown): value is SchemaRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstSentence(description: string): string {
    const sentence = /^.+?[.!?](?=\s|$)/s.exec(description)?.[0] ?? description;
    return sentence.length > MAX_DESCRIPTION_LENGTH ? `${sentence.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…` : sentence;
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

function compactSchema(schema: unknown, depth: number): unknown {
    if (!isRecord(schema)) {
        return schema;
    }
    if (depth > MAX_SCHEMA_DEPTH) {
        return collapseSchema(schema);
    }
    const compacted: SchemaRecord = {};
    for (const [keyword, value] of Object.entries(schema)) {
        if (PROMPT_ONLY_DROPPED_KEYWORDS.has(keyword)) {
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

/** A worked example closes the description, after the grammar it illustrates. */
function withoutWorkedExample(description: string): string {
    return description
        .split(/(?<=[.!?])\s+/)
        .slice(0, -1)
        .join(' ');
}

function keepGrammarDescription(original: unknown, compacted: unknown): unknown {
    const description = isRecord(original) ? original.description : undefined;
    if (typeof description !== 'string' || !isRecord(compacted)) {
        return compacted;
    }
    return { ...compacted, description: withoutWorkedExample(description) };
}

function compactProperties(toolName: string, parameters: SchemaRecord, properties: SchemaRecord): SchemaRecord {
    const referenced = REFERENCED_PROPERTIES[toolName] ?? [];
    const grammar = GRAMMAR_PROPERTIES[toolName] ?? [];
    const originalProperties = isRecord(parameters.properties) ? parameters.properties : {};
    return Object.fromEntries(
        Object.entries(properties).map(([name, property]) => {
            if (referenced.includes(name)) {
                return [name, { type: 'object' }];
            }
            return [
                name,
                grammar.includes(name) ? keepGrammarDescription(originalProperties[name], property) : property,
            ];
        })
    );
}

function compactParameters(toolName: string, parameters: SchemaRecord): SchemaRecord {
    const compacted = compactSchema(parameters, 0);
    if (!isRecord(compacted) || !isRecord(compacted.properties)) {
        return isRecord(compacted) ? compacted : parameters;
    }
    return { ...compacted, properties: compactProperties(toolName, parameters, compacted.properties) };
}

/**
 * The tool as the local model's prompt spells it. WebLLM serializes every advertised tool into the
 * system prompt, and the mandatory planning set no longer fits that window at full size, so the
 * prompt carries the first sentence of each description and the shape of each argument without its
 * annotations or bounds. The request that validates the model's reply keeps the full schema, so
 * nothing the application enforces is loosened.
 */
export function compactWebLlmToolSchema(tool: CompactableTool): CompactableTool {
    const { description, parameters } = tool.function;
    const compactedDescription = description === undefined ? {} : { description: firstSentence(description) };
    const compactedParameters =
        parameters === undefined ? {} : { parameters: compactParameters(tool.function.name, parameters) };
    return { ...tool, function: { ...tool.function, ...compactedDescription, ...compactedParameters } };
}
