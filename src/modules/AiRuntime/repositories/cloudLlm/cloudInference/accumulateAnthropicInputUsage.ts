import { type ModelProviderUsageCounterName } from '../../../models/ModelProviderProtocol';

export type AnthropicInputUsage = {
    inputTokens: number | null;
    cacheReadInputTokens: number | null;
    cacheWriteInputTokens: number | null;
};

export type AnthropicInputUsageState = {
    rawInputTokens?: number | null;
    cacheReadInputTokens?: number | null;
    cacheWriteInputTokens?: number | null;
};

type AccumulatedAnthropicInputUsage = {
    state: AnthropicInputUsageState;
    usage: AnthropicInputUsage;
    unavailableCounters: readonly ModelProviderUsageCounterName[];
};

function readTokenCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeAnthropicInputUsageState(state: AnthropicInputUsageState): {
    usage: AnthropicInputUsage;
    unavailableCounters: readonly ModelProviderUsageCounterName[];
} {
    const counters = [state.rawInputTokens, state.cacheReadInputTokens, state.cacheWriteInputTokens];
    const hasReportedCounter = counters.some((counter) => counter !== undefined);
    const hasReportedRawInput = state.rawInputTokens !== undefined;
    const hasMalformedCounter = counters.some((counter) => counter === null);
    let totalInputTokens = 0;
    for (const counter of counters) {
        totalInputTokens += counter ?? 0;
    }
    const inputTotalUnavailable =
        !hasReportedRawInput || hasMalformedCounter || !Number.isSafeInteger(totalInputTokens);
    const unavailableCounters: ModelProviderUsageCounterName[] = [];
    if (hasReportedCounter && inputTotalUnavailable) {
        unavailableCounters.push('inputTokens');
    }
    if (state.cacheReadInputTokens === null) {
        unavailableCounters.push('cachedInputTokens');
    }
    if (state.cacheWriteInputTokens === null) {
        unavailableCounters.push('cacheWriteInputTokens');
    }
    return {
        usage: {
            inputTokens: hasReportedRawInput && !inputTotalUnavailable ? totalInputTokens : null,
            cacheReadInputTokens: state.cacheReadInputTokens ?? null,
            cacheWriteInputTokens: state.cacheWriteInputTokens ?? null,
        },
        unavailableCounters,
    };
}

/**
 * Anthropic stream usage is cumulative but may omit unchanged components. Keep the
 * raw components separate until each snapshot is complete, then total them once.
 */
export function accumulateAnthropicInputUsage(
    previous: AnthropicInputUsageState,
    usage: Record<string, unknown>
): AccumulatedAnthropicInputUsage {
    const state: AnthropicInputUsageState = {};
    if (previous.rawInputTokens !== undefined) {
        state.rawInputTokens = previous.rawInputTokens;
    }
    if (previous.cacheReadInputTokens !== undefined) {
        state.cacheReadInputTokens = previous.cacheReadInputTokens;
    }
    if (previous.cacheWriteInputTokens !== undefined) {
        state.cacheWriteInputTokens = previous.cacheWriteInputTokens;
    }
    if (Object.hasOwn(usage, 'input_tokens')) {
        state.rawInputTokens = readTokenCount(usage.input_tokens);
    }
    if (Object.hasOwn(usage, 'cache_read_input_tokens')) {
        state.cacheReadInputTokens = readTokenCount(usage.cache_read_input_tokens);
    }
    if (Object.hasOwn(usage, 'cache_creation_input_tokens')) {
        state.cacheWriteInputTokens = readTokenCount(usage.cache_creation_input_tokens);
    }
    return { state, ...normalizeAnthropicInputUsageState(state) };
}
