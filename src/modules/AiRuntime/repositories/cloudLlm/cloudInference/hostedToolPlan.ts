import { type ToolCallResult } from '../../../transformers/toolCallParser';

/**
 * Token usage a hosted provider reported for one tool-planning request. Each field is
 * `null` when the provider's response carried no figure for it — a cache write, for
 * instance, is Anthropic-only and stays `null` for every other provider.
 */
export type HostedToolPlanUsage = {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadInputTokens: number | null;
    cacheWriteInputTokens: number | null;
};

/**
 * What one hosted tool-planning request returned: the calls it produced, the
 * provider's own identifier for the request that produced them (so a plan can be
 * correlated with the provider-side record regardless of protocol), whether the
 * request used a strict tool schema, and the provider-reported usage for the request.
 */
export type HostedToolPlan = {
    providerRequestId: string | null;
    calls: ToolCallResult[];
    strictToolSchemas: boolean;
    usage: HostedToolPlanUsage | null;
};
