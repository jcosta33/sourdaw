import { type ToolCallResult } from '../../../transformers/toolCallParser';

/**
 * What one hosted tool-planning request returned: the calls it produced and the
 * provider's own identifier for the request that produced them, so a plan can be
 * correlated with the provider-side record regardless of protocol.
 */
export type HostedToolPlan = {
    providerRequestId: string | null;
    calls: ToolCallResult[];
};
