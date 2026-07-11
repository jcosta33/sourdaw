import { describe, it, expect } from 'vitest';

import { createThinkBlockParser } from '../createThinkBlockParser';

type ThinkBlockResult = { reasoning: string | undefined; content: string };

function extractThinkBlock(raw: string): ThinkBlockResult {
    const match = raw.match(/^\s*<think>([\s\S]*?)<\/think>\s*/);
    if (match) {
        return {
            reasoning: match[1]?.trim() || undefined,
            content: raw.slice(match[0].length).trim(),
        };
    }

    const partialMatch = raw.match(/^\s*<think>([\s\S]*)$/);
    if (partialMatch) {
        return {
            reasoning: partialMatch[1]?.trim() || undefined,
            content: '',
        };
    }

    return { reasoning: undefined, content: raw };
}

const CASES: Array<{ name: string; text: string }> = [
    { name: 'no think block', text: 'Just a plain assistant reply with no tags.' },
    { name: 'fully formed block then content', text: '<think>reasoning here</think>Final answer.' },
    { name: 'block with trailing whitespace before content', text: '<think>plan</think>\n\n  Answer body' },
    { name: 'leading whitespace before opener', text: '   \n<think>weighing options</think>Done.' },
    { name: 'unclosed block (still thinking)', text: '<think>I am still reasoning and never close' },
    { name: 'only an opener', text: '<think>' },
    { name: 'multiline reasoning', text: '<think>line1\nline2\nline3</think>result\nmore' },
    { name: 'empty reasoning', text: '<think></think>content' },
    { name: 'content that itself mentions think word', text: '<think>x</think>I think the answer is 42.' },
];

/** Feed `full` to the parser split into tokens of size `chunk`, asserting the
 * incremental snapshot matches `extractThinkBlock(prefix)` after every token. */
function assertEquivalentForChunkSize(full: string, chunk: number): void {
    const parser = createThinkBlockParser();
    let prefix = '';
    for (let index = 0; index < full.length; index += chunk) {
        const token = full.slice(index, index + chunk);
        prefix += token;
        const incremental = parser.push(token);
        const oneShot = extractThinkBlock(prefix);
        expect(incremental, `mismatch at prefix=${JSON.stringify(prefix)} (chunk=${chunk})`).toEqual(oneShot);
    }
    // Final snapshot matches the full-buffer one-shot result.
    expect(parser.snapshot()).toEqual(extractThinkBlock(full));
}

describe('createThinkBlockParser', () => {
    for (const { name, text } of CASES) {
        for (const chunk of [1, 2, 3, 5, text.length || 1]) {
            it(`should match extractThinkBlock for "${name}" at chunk size ${chunk}`, () => {
                assertEquivalentForChunkSize(text, chunk);
            });
        }
    }

    it('should detect a </think> tag split across two tokens', () => {
        const parser = createThinkBlockParser();
        parser.push('<think>reason</thi');
        const result = parser.push('nk>answer');
        expect(result).toEqual({ reasoning: 'reason', content: 'answer' });
        expect(result).toEqual(extractThinkBlock('<think>reason</think>answer'));
    });

    it('should detect an opener split across tokens', () => {
        const parser = createThinkBlockParser();
        parser.push('<th');
        parser.push('ink>plan');
        const result = parser.push('</think>out');
        expect(result).toEqual({ reasoning: 'plan', content: 'out' });
    });

    it('should treat a non-think leading tag as plain content', () => {
        const parser = createThinkBlockParser();
        const result = parser.push('<thought>not a think block</thought>');
        expect(result).toEqual({ reasoning: undefined, content: '<thought>not a think block</thought>' });
    });
});
