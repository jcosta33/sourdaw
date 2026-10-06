import { describe, expect, it } from 'vitest';

import {
    LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
    LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
} from '../../models/LocalPlanningBudget';
import { budgetLocalPlanningRequest } from '../budgetLocalPlanningRequest';
import { estimateConservativePromptTokens } from '../estimateConservativePromptTokens';
import { describeLocalContextWindowShortfall, readEngineContextWindowShortfall } from '../localContextWindowRefusal';

describe('estimateConservativePromptTokens', () => {
    it.each([
        { text: '', tokens: 0 },
        { text: 'abc', tokens: 1 },
        { text: 'abcd', tokens: 2 },
        { text: '2048', tokens: 4 },
        { text: '{"gainDb":-1.5}', tokens: 2 + 5 },
        { text: 'é—♪', tokens: 1 },
    ])('counts "$text" as $tokens tokens: one per digit, a third of everything else', ({ text, tokens }) => {
        expect(estimateConservativePromptTokens(text)).toBe(tokens);
    });
});

describe('budgetLocalPlanningRequest', () => {
    const countLength = (text: string) => text.length;
    const fixedOverhead = LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS + LOCAL_PLANNING_REPLY_RESERVE_TOKENS;

    it('admits a request whose prompt and reply reserve fit, and bounds the reply to what is left', () => {
        const budget = budgetLocalPlanningRequest({
            systemPrompt: 'x'.repeat(1_000),
            userMessage: 'y'.repeat(500),
            windowTokens: 1_500 + fixedOverhead + 100,
            configuredMaxOutputTokens: 8_192,
            countTokens: countLength,
        });

        expect(budget).toEqual({
            status: 'admitted',
            promptTokens: 1_500 + LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
            maxOutputTokens: LOCAL_PLANNING_REPLY_RESERVE_TOKENS + 100,
        });
    });

    it('never raises the reply above the configured ceiling', () => {
        const budget = budgetLocalPlanningRequest({
            systemPrompt: 'x',
            userMessage: 'y',
            windowTokens: 100_000,
            configuredMaxOutputTokens: 1_024,
            countTokens: countLength,
        });

        expect(budget).toMatchObject({ status: 'admitted', maxOutputTokens: 1_024 });
    });

    it('admits a request that fills the window to the token, and refuses one token more', () => {
        const input = {
            systemPrompt: 'x'.repeat(1_000),
            userMessage: '',
            configuredMaxOutputTokens: 8_192,
            countTokens: countLength,
        };

        expect(budgetLocalPlanningRequest({ ...input, windowTokens: 1_000 + fixedOverhead })).toMatchObject({
            status: 'admitted',
            maxOutputTokens: LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
        });
        expect(budgetLocalPlanningRequest({ ...input, windowTokens: 1_000 + fixedOverhead - 1 })).toEqual({
            status: 'exceeded',
            neededTokens: 1_000 + fixedOverhead,
            windowTokens: 1_000 + fixedOverhead - 1,
        });
    });

    it('counts through the conservative estimate unless a counter is supplied', () => {
        const budget = budgetLocalPlanningRequest({
            systemPrompt: 'abcdef',
            userMessage: '123',
            windowTokens: 4_096,
            configuredMaxOutputTokens: 8_192,
        });

        expect(budget).toMatchObject({
            status: 'admitted',
            promptTokens: 2 + 3 + LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS,
        });
    });
});

describe('local context window refusal', () => {
    const fallback = { neededTokens: 1, windowTokens: 2 };

    it('names the needed and available tokens and points at a hosted model', () => {
        expect(describeLocalContextWindowShortfall({ neededTokens: 31_240, windowTokens: 24_576 })).toBe(
            "This request needs about 31,240 tokens of the local model's context window, 2,048 of them reserved for its reply, and the window holds 24,576. Use a hosted model for a request this large."
        );
    });

    it("reads web-llm's overflow figures, adding the reply reserve to the prompt it counted", () => {
        const error = new Error(
            'Prompt tokens exceed context window size: number of prompt tokens: 30000; context window size: 24576\nConsider shortening the prompt, or increase `context_window_size`, or using sliding window via `sliding_window_size`.'
        );

        expect(readEngineContextWindowShortfall(error, fallback)).toEqual({
            neededTokens: 30_000 + LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
            windowTokens: 24_576,
        });
    });

    it('falls back to the request budget when the overflow names no figures', () => {
        expect(readEngineContextWindowShortfall('Prompt tokens exceed context window size', fallback)).toBe(fallback);
    });

    it('leaves every other engine failure alone', () => {
        expect(readEngineContextWindowShortfall(new Error('WebGPU device lost'), fallback)).toBeNull();
    });
});
