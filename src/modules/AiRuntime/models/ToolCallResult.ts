/**
 * Where a call's arguments first leave the tool schema the request advertised: a JSON Pointer to
 * the failing location, every segment bounded and any segment outside a plain identifier shape
 * replaced by `*`, so the pointer is safe to hand back to the provider that wrote the arguments.
 */
export type ToolArgumentSchemaViolation = {
    kind: 'missing-property' | 'undeclared-property' | 'invalid-value';
    path: string;
};

/**
 * One tool call a provider asked for. The `id` is the provider's own identifier for the
 * call and is absent when the provider reported none, so a caller that must correlate a
 * result with its call supplies its own identity instead. `argumentSchemaViolation` is set
 * only by provider admission, for a call whose schema the provider did not enforce and whose
 * caller answers the mismatch: such a call is data to refuse, never a call to execute.
 */
export type ToolCallResult = {
    id?: string;
    name: string;
    arguments: Record<string, unknown>;
    argumentSchemaViolation?: ToolArgumentSchemaViolation;
};
