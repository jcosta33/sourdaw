import { accumulateAnthropicInputUsage, type AnthropicInputUsage } from './accumulateAnthropicInputUsage';

/**
 * Anthropic reports uncached input, cache reads, and cache creation separately. The
 * provider-neutral input total includes all three, while the cache counters remain
 * available for attribution. A malformed or overflowing reported counter invalidates
 * the total rather than silently undercounting it.
 */
export function normalizeAnthropicInputUsage(usage: Record<string, unknown>): AnthropicInputUsage {
    return accumulateAnthropicInputUsage({}, usage).usage;
}
