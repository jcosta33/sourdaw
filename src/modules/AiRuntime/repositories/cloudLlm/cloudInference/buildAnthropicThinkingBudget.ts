import { type HostedAnthropicThinking } from '../../../models/HostedLlmProvider';

/**
 * How much of its thinking the response carries back: a tool-planning request reads none
 * of it, a chat stream renders the summarized text as the message's reasoning.
 */
export type AnthropicThinkingDisplay = 'omitted' | 'summarized';

export type AnthropicThinkingWire =
    { type: 'adaptive'; display: AnthropicThinkingDisplay } | { type: 'enabled'; budget_tokens: number };

/**
 * The output budget one Anthropic request sends: its `max_tokens` and, when the profile
 * configures extended thinking, the `thinking` object that goes beside it. Thinking tokens
 * are billed against `max_tokens`, so a fixed budget is added to the caller's output limit
 * rather than taken out of it — otherwise enabling thinking silently shortens the answer.
 */
export type AnthropicThinkingBudget = {
    maxTokens: number;
    thinking: AnthropicThinkingWire | null;
};

export function buildAnthropicThinkingBudget(input: {
    thinking: HostedAnthropicThinking | undefined;
    display: AnthropicThinkingDisplay;
    maxOutputTokens: number;
}): AnthropicThinkingBudget {
    if (input.thinking === undefined) {
        return { maxTokens: input.maxOutputTokens, thinking: null };
    }
    if (input.thinking.type === 'adaptive') {
        return { maxTokens: input.maxOutputTokens, thinking: { type: 'adaptive', display: input.display } };
    }
    return {
        maxTokens: input.maxOutputTokens + input.thinking.budgetTokens,
        thinking: { type: 'enabled', budget_tokens: input.thinking.budgetTokens },
    };
}
