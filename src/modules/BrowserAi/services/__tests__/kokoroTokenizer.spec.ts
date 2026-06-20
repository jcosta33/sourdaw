import { describe, it, expect } from 'vitest';

import { textToKokoroInputIds } from '../kokoroTokenizer';

describe('textToKokoroInputIds', () => {
    it('produces padded int64 ids and no warnings for ordinary text', () => {
        const { inputIds, tokenCount, warnings } = textToKokoroInputIds('hello world');

        // Padded with 0 at both ends.
        expect(inputIds[0]).toBe(0n);
        expect(inputIds[inputIds.length - 1]).toBe(0n);
        // tokenCount is the pre-padding phoneme-token count.
        expect(tokenCount).toBe(inputIds.length - 2);
        expect(tokenCount).toBeGreaterThan(0);
        expect(warnings).toEqual([]);
    });

    it('throws on whitespace-only input that produces no phonemes', () => {
        expect(() => textToKokoroInputIds('   ')).toThrow(/no phonemes/i);
    });

    // Regression: input longer than the 510-token limit used to be silently
    // truncated (splice(510)) with no signal to the caller. Truncation must now
    // surface a warning AND tokenCount must reflect the truncated length so the
    // voice-embedding lookup matches the real sequence.
    it('warns and reports the truncated length when the input exceeds the token limit', () => {
        // A long run of words reliably produces well over 510 phoneme tokens.
        const longText = Array.from({ length: 400 }, () => 'wonderful').join(' ');
        const { inputIds, tokenCount, warnings } = textToKokoroInputIds(longText);

        expect(tokenCount).toBe(510);
        // Padded sequence is exactly 510 + 2 pad tokens.
        expect(inputIds.length).toBe(512);
        expect(warnings.length).toBeGreaterThanOrEqual(1);
        expect(warnings.some((warning) => /truncat/i.test(warning))).toBe(true);
    });
});
