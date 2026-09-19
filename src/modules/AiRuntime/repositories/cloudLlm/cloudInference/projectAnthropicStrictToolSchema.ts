import { type ToolSchema } from '../../../models/Tools/Types';

import { walkSchemaNode } from './toolSchemaProjectionCore';

/**
 * Projects a Sourdaw {@link ToolSchema} into the `input_schema` Anthropic's strict
 * tool use expects when a tool call sets `strict: true`.
 *
 * Rules read from Anthropic's live docs on 2026-09-18:
 * - Strict tool use (`docs.claude.com/en/docs/agents-and-tools/tool-use/fine-grained-tool-streaming`
 *   and `docs.claude.com/en/docs/build-with-claude/tool-use`, "Strict mode" section): a strict tool's
 *   `input_schema` is grammar-constrained during sampling, so Claude cannot violate `type`,
 *   `enum`, `required`, or `additionalProperties`. Numeric and string bound keywords
 *   (`minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`,
 *   `maxLength`, `pattern`, `format`) are NOT enforced by the grammar and are ignored at the
 *   schema level, so Anthropic's own examples move any such bound into the property's
 *   `description` for the model to follow as guidance rather than a constraint.
 * - Structured outputs / JSON Schema limitations (`platform.claude.com/docs/en/build-with-claude/structured-outputs`,
 *   confirmed by direct page read on 2026-09-18): `$ref` requires a resolvable `$defs` entry
 *   in the same schema document; Sourdaw tool schemas carry no `$defs` registry, so any
 *   `$ref` is rejected rather than silently forwarded. The "Supported" list names `anyOf`
 *   and `allOf` but not `oneOf`, so a `oneOf` branch set 400s and is rewritten onto `anyOf`.
 *   The "Not supported" list states "Array constraints beyond `minItems` of 0 or 1" —
 *   covering both `maxItems` and `uniqueItems` unconditionally — and separately documents
 *   `minItems` itself as "only values 0 and 1 supported", which is what the 0/1 clamp below
 *   enforces. Unlike OpenAI, Anthropic's strict dialect does not require every property to
 *   be listed in `required` — optional properties may stay absent from `required` and are
 *   simply omitted from the call when the model has nothing to put there.
 *
 * Sourdaw policy: every numeric and string bound already has a single source of truth in
 * `validateActionPayload.ts`, which validates the app-action payload after a tool call
 * resolves. This projection never re-derives or duplicates those bounds on the wire; it
 * strips them from the schema and folds a plain-language restatement into the description,
 * exactly as Anthropic's own strict-mode guidance recommends.
 */
export function projectAnthropicStrictToolSchema(schema: ToolSchema): ToolSchema {
    const projectedParameters = walkSchemaNode(schema.function.parameters, [schema.function.name], {
        forceAllRequired: false,
    });

    return {
        ...schema,
        function: {
            ...schema.function,
            parameters: projectedParameters as ToolSchema['function']['parameters'],
        },
    };
}
