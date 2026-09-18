import { type ToolSchema } from '../../../models/Tools/Types';

import { walkSchemaNode } from './toolSchemaProjectionCore';

/**
 * Projects a Sourdaw {@link ToolSchema} into the `parameters` shape OpenAI's strict
 * function calling and strict structured outputs expect when a tool sets `strict: true`.
 *
 * Rules read from OpenAI's live docs on 2026-09-18:
 * - Function calling (`platform.openai.com/docs/guides/function-calling`, "Strict mode"):
 *   setting `strict: true` on a tool requires its `parameters` schema to satisfy the
 *   structured-outputs subset below; the API rejects a strict tool whose schema does not.
 * - Structured outputs, "Supported schemas" (`developers.openai.com/api/docs/guides/structured-outputs`,
 *   confirmed by direct page read on 2026-09-18): every object node must set
 *   `additionalProperties: false` and every key in `properties` must appear in `required`
 *   — there is no concept of an optional property in strict mode, only a required property
 *   whose type is unioned with `null`. `allOf`, `not`, `dependentRequired`,
 *   `dependentSchemas`, and `if`/`then`/`else` are unsupported unconditionally. Root-level
 *   validation keywords such as `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`,
 *   `pattern`, `format`, `minItems`, and `maxItems` ARE accepted by the API for standard
 *   models (only a *fine-tuned* model additionally drops them) — narrower than a first read
 *   of "unsupported keywords" suggests. Sourdaw does not target fine-tuned models, so this
 *   projection strips them anyway: `validateActionPayload.ts` is the single source of every
 *   bound after a tool call resolves, and the wire schema must not carry a second, divergent
 *   copy of the same limit. This is a deliberate Sourdaw policy choice layered on top of what
 *   the API would technically accept, not a misreading of the OpenAI limitation list.
 * - `$ref` is supported only against an in-document `$defs` registry; Sourdaw tool schemas
 *   carry none, so any `$ref` is rejected rather than silently forwarded or dropped.
 *
 * OpenAI's all-required-with-nullable pattern (`walkSchemaNode` with
 * `forceAllRequired: true`) is what forces every property from the source schema's
 * `required` and non-`required` lists alike onto the projected `required` array; a
 * property that was optional in the source schema is nullable in the projected one,
 * so the model must return `null` rather than omit the key.
 */
export function projectOpenAiStrictToolSchema(schema: ToolSchema): ToolSchema {
    const projectedParameters = walkSchemaNode(schema.function.parameters, [schema.function.name], {
        forceAllRequired: true,
    });

    return {
        ...schema,
        function: {
            ...schema.function,
            parameters: projectedParameters as ToolSchema['function']['parameters'],
        },
    };
}
