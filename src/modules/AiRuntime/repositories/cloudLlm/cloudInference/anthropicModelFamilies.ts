const FORCED_TOOL_CHOICE_REJECTING_PREFIXES = ['claude-fable-5-1', 'claude-mythos-5-1'] as const;

/**
 * Whether the model refuses a forced `tool_choice` on a Messages request. These families
 * answer such a request with an error rather than a tool call, so the directive must be
 * carried by the advertised tool set alone.
 */
export function anthropicModelRejectsForcedToolChoice(model: string): boolean {
    return FORCED_TOOL_CHOICE_REJECTING_PREFIXES.some((prefix) => model.startsWith(prefix));
}
