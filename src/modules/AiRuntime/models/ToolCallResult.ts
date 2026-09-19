/**
 * One tool call a provider asked for. The `id` is the provider's own identifier for the
 * call and is absent when the provider reported none, so a caller that must correlate a
 * result with its call supplies its own identity instead.
 */
export type ToolCallResult = { id?: string; name: string; arguments: Record<string, unknown> };
