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
    ])('counts "$text" as $tokens tokens: one per digit, a third of everything else', ({ text, tokens }) => {
        expect(estimateConservativePromptTokens(text)).toBe(tokens);
    });

    // Qwen's pre-tokenizer encodes each chunk on its own: every digit, every letter run (with one
    // leading non-letter) and every punctuation run. The chunk counts below are worked by hand from
    // its split, and each is a floor the model's own count never goes under.
    it.each([
        // track, -, then every hex digit and hex letter alone, "-a" joined: 37 chunks; the
        // character rule alone gives 18 digits + ceil(24 / 3) = 26.
        { label: 'a production track id', text: 'track-3f2a9c1e-0b7d-4e85-a6f1-92c4d0e8b7a3', chunks: 37 },
        // "(a", then ")(" and "a" in turn, closed by ")": 600; the character rule gives 300.
        { label: 'alternating letters and punctuation', text: '(a)'.repeat(300), chunks: 600 },
        // "a", then " b", " c" … each a chunk, and the trailing space: 501; the rule gives 334.
        { label: 'one-letter words', text: 'a b c d e '.repeat(100), chunks: 501 },
        // "音", "🎵乐" (a non-letter joins the letters after it), "🎵": 3; the rule gives 2.
        { label: 'CJK and emoji', text: '音🎵乐🎵', chunks: 3 },
        // "é", then the run "—♪": 2; the rule gives 1.
        { label: 'an accented letter and symbols', text: 'é—♪', chunks: 2 },
    ])('never budgets $label below its pre-tokenizer chunk count', ({ text, chunks }) => {
        expect(estimateConservativePromptTokens(text)).toBe(chunks);
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

    it('points at a local model whose window holds the request when there is one', () => {
        expect(describeLocalContextWindowShortfall({ neededTokens: 21_020, windowTokens: 8_192 }, 'Standard')).toBe(
            "This request needs about 21,020 tokens of the local model's context window, 2,048 of them reserved for its reply, and the window holds 8,192. Switch to the Standard local model, whose window holds it, or use a hosted model."
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
