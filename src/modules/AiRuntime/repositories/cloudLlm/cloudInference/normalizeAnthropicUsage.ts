type AnthropicInputUsage = {
    inputTokens: number | null;
    cacheReadInputTokens: number | null;
    cacheWriteInputTokens: number | null;
};

const INPUT_COUNTER_KEYS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;

function readTokenCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Anthropic reports uncached input, cache reads, and cache creation separately. The
 * provider-neutral input total includes all three, while the cache counters remain
 * available for attribution. A malformed or overflowing reported counter invalidates
 * the total rather than silently undercounting it.
 */
export function normalizeAnthropicInputUsage(usage: Record<string, unknown>): AnthropicInputUsage {
    const inputTokens = readTokenCount(usage.input_tokens);
    const cacheReadInputTokens = readTokenCount(usage.cache_read_input_tokens);
    const cacheWriteInputTokens = readTokenCount(usage.cache_creation_input_tokens);
    const counters = [inputTokens, cacheReadInputTokens, cacheWriteInputTokens];
    const hasMalformedCounter = INPUT_COUNTER_KEYS.some(
        (key, index) => Object.hasOwn(usage, key) && counters[index] === null
    );
    if (hasMalformedCounter || counters.every((counter) => counter === null)) {
        return { inputTokens: null, cacheReadInputTokens, cacheWriteInputTokens };
    }
    let totalInputTokens = 0;
    for (const counter of counters) {
        totalInputTokens += counter ?? 0;
    }
    return {
        inputTokens: Number.isSafeInteger(totalInputTokens) ? totalInputTokens : null,
        cacheReadInputTokens,
        cacheWriteInputTokens,
    };
}
