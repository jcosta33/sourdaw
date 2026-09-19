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
 *   whose type is unioned with `null`. "Supported types" lists `anyOf` but not `oneOf`, so a
 *   `oneOf` branch set 400s and is rewritten onto `anyOf`. `allOf`, `not`,
 *   `dependentRequired`, `dependentSchemas`, and `if`/`then`/`else` are unsupported
 *   unconditionally. Root-level validation keywords `minimum`, `maximum`, `multipleOf`,
 *   `minLength`, `maxLength`, `pattern`, and `format` are also unsupported unconditionally
 *   and are stripped. `minItems`/`maxItems` are different: "Supported array properties"
 *   names both as accepted, and the doc's fine-tuned-model carve-out ("For fine-tuned
 *   models, we additionally do not support... `minItems`, `maxItems`") does not apply,
 *   since Sourdaw never calls a fine-tuned model — so OpenAI would accept them. Sourdaw
 *   strips `maxItems` anyway as policy (`validateActionPayload.ts` is the single source of
 *   every bound after a tool call resolves, and the wire schema must not carry a second,
 *   divergent copy) but leaves `minItems` to the shared 0/1 clamp below, written for
 *   Anthropic's narrower support — a harmless no-op here since OpenAI accepts it unclamped.
 *   `uniqueItems` never appears in "Supported array properties" at all, so it is
 *   unconditionally unsupported (not a policy choice) and is stripped.
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
