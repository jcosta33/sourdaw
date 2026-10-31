import { describe, expect, it } from 'vitest';

import { getPromptClauses } from '../getPromptClauses';

function clauseTexts(prompt: string): string[] {
    return getPromptClauses(prompt, prompt).map((clause) => clause.text.trim());
}

describe('getPromptClauses', () => {
    it('ends a clause at a connector wherever its whitespace run starts', () => {
        expect(clauseTexts('raise Drums   and then cut Bass')).toEqual(['raise Drums', 'cut Bass']);
        expect(clauseTexts('mute Drums,\n and solo Bass')).toEqual(['mute Drums', 'solo Bass']);
        expect(clauseTexts('mute Drums.\n\n  but solo Bass; pan Keys')).toEqual([
            'mute Drums',
            'solo Bass',
            'pan Keys',
        ]);
    });

    it('reads a long whitespace run without rescanning it from every position', () => {
        const run = ' '.repeat(200_000);

        const clauses = getPromptClauses(`mute Drums${run}please, solo Bass`, `mute Drums${run}please, solo Bass`);

        expect(clauses.map((clause) => clause.text.length)).toEqual([10 + run.length + 6, 10]);
    });
});
