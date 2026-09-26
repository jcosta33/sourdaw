import { type ToolSchema } from '../../../models/Tools/Types';

/**
 * Anthropic's documented strict-tool schema complexity caps, which apply to the
 * combined total across every strict schema in one request. Read from
 * `platform.claude.com/docs/en/build-with-claude/structured-outputs`,
 * "Schema complexity limits" > "Explicit limits", live-doc-verified 2026-09-26:
 * - "Strict tools per request: 20 — Maximum number of tools with `strict: true`.
 *   Non-strict tools don't count toward this limit."
 * - "Optional parameters: 24 — Total optional parameters across all strict tool
 *   schemas and JSON output schemas. Each parameter not listed in `required`
 *   counts toward this limit."
 * - "Parameters with union types: 16 — Total parameters that use `anyOf` or type
 *   arrays (for example, `"type": ["string", "null"]`) across all strict schemas."
 * The same section's first complexity tip — "Mark only critical tools as strict
 * ... rely on Claude's natural adherence for simpler tools" — is exactly what
 * {@link selectAnthropicStrictTools} does for a tool that would blow one of the
 * three budgets below.
 */
export const ANTHROPIC_STRICT_TOOL_CAP = 20;
export const ANTHROPIC_STRICT_OPTIONAL_PARAMETER_CAP = 24;
export const ANTHROPIC_STRICT_UNION_PARAMETER_CAP = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnionNode(node: Record<string, unknown>): boolean {
    return Array.isArray(node.anyOf) || Array.isArray(node.type);
}

type SchemaComplexity = { optionalParameters: number; unionParameters: number };

function addComplexity(left: SchemaComplexity, right: SchemaComplexity): SchemaComplexity {
    return {
        optionalParameters: left.optionalParameters + right.optionalParameters,
        unionParameters: left.unionParameters + right.unionParameters,
    };
}

/**
 * Counts one schema node's own contribution to the two per-parameter budgets, then
 * adds every nested contribution: an object node's own `properties`, an array
 * node's `items`, and each `anyOf`/`allOf` branch — at every nesting depth, per the
 * docs' combined-total rule. A property absent from its object's `required` counts
 * as one optional parameter; a node carrying its own `anyOf` or a `type` array
 * counts as one union parameter. The root parameters object passed in is never
 * itself a "parameter" — only its `properties` entries, and anything nested under
 * them, are counted.
 */
function countSchemaComplexity(node: unknown): SchemaComplexity {
    if (!isRecord(node)) {
        return { optionalParameters: 0, unionParameters: 0 };
    }
    let complexity: SchemaComplexity = { optionalParameters: 0, unionParameters: isUnionNode(node) ? 1 : 0 };
    if (isRecord(node.properties)) {
        const required = new Set(Array.isArray(node.required) ? node.required : []);
        for (const [propertyName, propertySchema] of Object.entries(node.properties)) {
            complexity = addComplexity(complexity, {
                optionalParameters: required.has(propertyName) ? 0 : 1,
                unionParameters: 0,
            });
            complexity = addComplexity(complexity, countSchemaComplexity(propertySchema));
        }
    }
    if (node.items !== undefined) {
        complexity = addComplexity(complexity, countSchemaComplexity(node.items));
    }
    for (const branchKey of ['anyOf', 'allOf'] as const) {
        const branches = node[branchKey];
        if (!Array.isArray(branches)) {
            continue;
        }
        for (const branch of branches) {
            complexity = addComplexity(complexity, countSchemaComplexity(branch));
        }
    }
    return complexity;
}

/**
 * Selects which of the advertised, already strict-schema-projected wire tools may
 * carry `strict: true` on one Anthropic request without crossing the documented
 * complexity caps above. First fit in advertised order: a tool is admitted only
 * when its own tool, optional-parameter, and union-parameter counts all still fit
 * inside the remaining combined budget; a tool that would blow any one of the
 * three is sent non-strict and the walk continues onto the next tool, so a later,
 * smaller tool can still be admitted.
 */
export function selectAnthropicStrictTools(toolSchemas: readonly ToolSchema[]): readonly boolean[] {
    let toolsUsed = 0;
    let optionalParametersUsed = 0;
    let unionParametersUsed = 0;
    const admitted: boolean[] = [];
    for (const schema of toolSchemas) {
        const { optionalParameters, unionParameters } = countSchemaComplexity(schema.function.parameters);
        const fits =
            toolsUsed + 1 <= ANTHROPIC_STRICT_TOOL_CAP &&
            optionalParametersUsed + optionalParameters <= ANTHROPIC_STRICT_OPTIONAL_PARAMETER_CAP &&
            unionParametersUsed + unionParameters <= ANTHROPIC_STRICT_UNION_PARAMETER_CAP;
        if (fits) {
            toolsUsed += 1;
            optionalParametersUsed += optionalParameters;
            unionParametersUsed += unionParameters;
        }
        admitted.push(fits);
    }
    return admitted;
}
