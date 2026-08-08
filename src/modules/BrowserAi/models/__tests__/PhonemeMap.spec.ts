import { describe, expect, it } from 'vitest';

import { DEFAULT_EN_PHONEME_MAP } from '../PhonemeMap';

describe('DEFAULT_EN_PHONEME_MAP', () => {
    it('assigns SP (silence) to token 0 and AP (breath) to token 1', () => {
        expect(DEFAULT_EN_PHONEME_MAP.SP).toBe(0);
        expect(DEFAULT_EN_PHONEME_MAP.AP).toBe(1);
    });

    it('maps every phoneme to a unique non-negative integer token', () => {
        const tokens = Object.values(DEFAULT_EN_PHONEME_MAP);

        for (const token of tokens) {
            expect(token).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(token)).toBe(true);
        }
        // All tokens unique.
        expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('includes all standard CMU ARPAbet vowel phonemes', () => {
        const vowels = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW'];
        for (const v of vowels) {
            expect(DEFAULT_EN_PHONEME_MAP[v]).toBeDefined();
        }
    });

    it('includes all standard CMU ARPAbet consonant phonemes', () => {
        const consonants = [
            'B',
            'CH',
            'D',
            'DH',
            'F',
            'G',
            'HH',
            'JH',
            'K',
            'L',
            'M',
            'N',
            'NG',
            'P',
            'R',
            'S',
            'SH',
            'T',
            'TH',
            'V',
            'W',
            'Y',
            'Z',
            'ZH',
        ];
        for (const c of consonants) {
            expect(DEFAULT_EN_PHONEME_MAP[c]).toBeDefined();
        }
    });

    it('has 41 entries total (SP + AP + 39 phonemes)', () => {
        expect(Object.keys(DEFAULT_EN_PHONEME_MAP)).toHaveLength(41);
    });

    it('uses a contiguous token range starting from 0', () => {
        const tokens = Object.values(DEFAULT_EN_PHONEME_MAP).sort((a, b) => a - b);

        expect(tokens[0]).toBe(0);
        expect(tokens[tokens.length - 1]).toBe(40);
        for (let i = 0; i < tokens.length; i += 1) {
            expect(tokens[i]).toBe(i);
        }
    });
});
