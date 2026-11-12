type WebLlmPlanningTool = {
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectNode(schema: SchemaRecord): boolean {
    const { type } = schema;
    return type === 'object' || (Array.isArray(type) && type.includes('object')) || isRecord(schema.properties);
}

/**
 * web-llm compiles the schema in strict mode: an object node that does not state
 * `additionalProperties` admits no unlisted key there, while JSON Schema, which validates the
 * reply, admits any. Stating `true` where the schema is silent makes the constraint admit exactly
 * what validation admits. An explicit value is never overridden.
 */
function admitUnlistedKeys(node: unknown): unknown {
    if (Array.isArray(node)) {
        return node.map(admitUnlistedKeys);
    }
    if (!isRecord(node)) {
        return node;
    }
    const filled: SchemaRecord = {};
    for (const [keyword, value] of Object.entries(node)) {
        if (keyword === 'properties' && isRecord(value)) {
            filled[keyword] = Object.fromEntries(
                Object.entries(value).map(([name, property]) => [name, admitUnlistedKeys(property)])
            );
        } else if (['items', 'anyOf', 'oneOf', 'allOf', 'additionalProperties', 'not'].includes(keyword)) {
            filled[keyword] = admitUnlistedKeys(value);
        } else {
            filled[keyword] = value;
        }
    }
    if (isObjectNode(node) && !Object.hasOwn(node, 'additionalProperties')) {
        filled.additionalProperties = true;
    }
    return filled;
}

function toolCallBranch(tool: WebLlmPlanningTool): SchemaRecord {
    const parameters = tool.function.parameters ?? { type: 'object' };
    return {
        type: 'object',
        properties: {
            id: { type: 'string', minLength: 1 },
            name: { const: tool.function.name },
            arguments: admitUnlistedKeys(parameters),
        },
        required: ['id', 'name', 'arguments'],
        additionalProperties: false,
    };
}

/**
 * The JSON schema, as the string web-llm's `response_format` takes, that constrains decoding of a
 * local tool-planning reply: an array of calls, each one of the offered tools with its own full
 * `parameters` schema as `arguments`. This is the reply shape `serializeWebLlmToolPlanningPrompt`
 * asks for, and a subset of what `parseToolPlanningOutcome` accepts.
 *
 * The tool's full schema constrains decoding, not the compacted text the prompt shows. Validation
 * runs against the full schema, so a reply the full-schema constraint admits can be refused only for
 * a keyword the grammar engine cannot express, and the compacted text keeps every validating
 * keyword for the model to read. The compacted schema collapses nodes past its depth limit and
 * introduces `$defs`/`$ref`, so constraining by it could admit replies validation refuses.
 * Nothing here trusts the constraint as validation: the reply is still checked.
 */
export function buildWebLlmDecodingSchema(tools: readonly WebLlmPlanningTool[]): string {
    if (tools.length === 0) {
        return JSON.stringify({ type: 'array', maxItems: 0 });
    }
    return JSON.stringify({ type: 'array', items: { anyOf: tools.map(toolCallBranch) } });
}
