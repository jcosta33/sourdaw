import { describe, it, expect } from 'vitest';

import { extractThinkBlock, createThinkBlockParser } from '../sendChatMessage';

/**
 * The incremental parser must, at every step of a streamed sequence, return the
 * same `{ reasoning, content }` the one-shot `extractThinkBlock` returns for the
 * buffer accumulated so far. That equivalence is what lets the streaming loop
 * drop the per-token full-buffer rescan (the quadratic bug) without changing
 * any observable output.
 */

/** Feed `full` to the parser split into tokens of size `chunk`, asserting the
 * incremental snapshot matches `extractThinkBlock(prefix)` after every token. */
function assertEquivalentForChunkSize(full: string, chunk: number): void {
    const parser = createThinkBlockParser();
    let prefix = '';
    for (let i = 0; i < full.length; i += chunk) {
        const token = full.slice(i, i + chunk);
        prefix += token;
        const incremental = parser.push(token);
        const oneShot = extractThinkBlock(prefix);
        expect(incremental, `mismatch at prefix=${JSON.stringify(prefix)} (chunk=${chunk})`).toEqual(oneShot);
    }
    // Final snapshot matches the full-buffer one-shot result.
    expect(parser.snapshot()).toEqual(extractThinkBlock(full));
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

describe('createThinkBlockParser', () => {
    for (const { name, text } of CASES) {
        for (const chunk of [1, 2, 3, 5, text.length || 1]) {
            it(`matches extractThinkBlock for "${name}" at chunk size ${chunk}`, () => {
                assertEquivalentForChunkSize(text, chunk);
            });
        }
    }

    it('detects a </think> tag split across two tokens', () => {
        const parser = createThinkBlockParser();
        parser.push('<think>reason</thi');
        const result = parser.push('nk>answer');
        expect(result).toEqual({ reasoning: 'reason', content: 'answer' });
        expect(result).toEqual(extractThinkBlock('<think>reason</think>answer'));
    });

    it('detects an opener split across tokens', () => {
        const parser = createThinkBlockParser();
        parser.push('<th');
        parser.push('ink>plan');
        const result = parser.push('</think>out');
        expect(result).toEqual({ reasoning: 'plan', content: 'out' });
    });

    it('treats a non-think leading tag as plain content', () => {
        const parser = createThinkBlockParser();
        const result = parser.push('<thought>not a think block</thought>');
        expect(result).toEqual({ reasoning: undefined, content: '<thought>not a think block</thought>' });
    });
});
