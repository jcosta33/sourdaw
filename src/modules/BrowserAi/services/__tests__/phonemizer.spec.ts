import { describe, it, expect } from 'vitest';

import { phonemize, parsePhonemesTxt } from '../phonemizer';

// Helper: run a single out-of-vocabulary word through phonemize() and strip the
// leading/trailing SP silence tokens the function always wraps around content.
// applyG2p() itself is not exported, so this is the only way to exercise the
// G2P rule engine's decision paths (all words below are verified absent from
// EXCEPTION_DICT, so they fall through to the rule engine).
function g2pPhonemes(word: string): string[] {
    const { phonemes } = phonemize({ lyrics: word, phonemeToId: {} });
    return phonemes.slice(1, -1);
}

describe('phonemize — G2P rule engine (out-of-vocabulary words)', () => {
    it.each<[string, string[]]>([
        // ── Word-initial silent pairs (rule.p context) ──────────────────────
        ['gnome', ['N', 'OW', 'M']], // gn (initial, p matches) + magic-e o + silent final e
        ['knish', ['N', 'IH', 'SH']], // kn (initial, p matches)
        ['wrath', ['R', 'AE', 'TH']], // wr (initial, p matches) + th
        ['assign', ['AE', 'S', 'S', 'IH', 'N']], // gn (initial rule's p fails mid-word) -> mid-word gn fallback

        // ── Word-final silent clusters (rule.s context) ─────────────────────
        ['iamb', ['IH', 'AE', 'M']], // mb (s matches: word-final)
        ['amber', ['AE', 'M', 'B', 'EH', 'R']], // mb (s fails: not word-final) -> default m + b
        ['hymn', ['HH', 'IH', 'M']], // mn (s matches: word-final; consumes both m and n)

        // ── ng: context-sensitive digraph ───────────────────────────────────
        ['zing', ['Z', 'IH', 'NG']], // ng before end -> NG
        ['anger', ['AE', 'N', 'G', 'EH', 'R']], // ng before vowel -> s fails -> N,G fallback

        // ── dg / dge: trigraph pre-empts the digraph ────────────────────────
        ['badge', ['B', 'EY', 'JH']], // magic-e 'a' fires before 'dge' trigraph is reached
        ['dodgy', ['D', 'AA', 'JH', 'IY']], // dg (s=[eiy] matches on 'y') + y-final
        ['handgun', ['HH', 'AE', 'N', 'D', 'G', 'AH', 'N']], // dg (s fails on 'u') -> default d + g-hard

        // ── c / g: soft vs hard ──────────────────────────────────────────────
        ['cell', ['S', 'EH', 'L', 'L']], // c-soft (before e)
        ['jog', ['JH', 'AA', 'G']], // g-hard (before o, soft rule fails)
        ['gem', ['JH', 'EH', 'M']], // g-soft (before e)

        // ── x: vowel_vowel context ───────────────────────────────────────────
        ['exam', ['EH', 'G', 'Z', 'AE', 'M']], // vowel-x-vowel -> G,Z
        ['fox', ['F', 'AA', 'K', 'S']], // word-final x (no following vowel) -> K,S

        // ── ew: preceding-consonant-class context ───────────────────────────
        ['crew', ['K', 'R', 'UW']], // ew after r (in class) -> UW
        ['pew', ['P', 'Y', 'UW']], // ew after p (not in class) -> Y,UW

        // ── oo: before-k context ─────────────────────────────────────────────
        ['book', ['B', 'UH', 'K']], // oo before k -> UH
        ['food', ['F', 'UW', 'D']], // oo elsewhere -> UW

        // ── Magic-e (stressed vowel + consonant(s) + silent e) ──────────────
        ['bake', ['B', 'EY', 'K']], // magic-e a
        ['hive', ['HH', 'AY', 'V']], // magic-e i
        ['note', ['N', 'OW', 'T']], // magic-e o
        ['rude', ['R', 'UW', 'D']], // magic-e u
        ['piece', ['P', 'IY', 'S']], // ie digraph + silent final e

        // ── y: position-sensitive (initial+vowel, initial+consonant, final, default) ──
        ['yes', ['Y', 'EH', 'S']], // y initial, before vowel
        ['yttrium', ['Y', 'T', 'T', 'R', 'IH', 'AH', 'M']], // y initial, before consonant
        ['gravy', ['G', 'R', 'AE', 'V', 'IY']], // y final
        ['gym', ['G', 'IH', 'M']], // y default (mid-word)

        // ── Plain digraphs / trigraphs ───────────────────────────────────────
        ['catchy', ['K', 'AE', 'CH', 'IY']], // tch trigraph + y-final
        ['chop', ['CH', 'AA', 'P']], // ch digraph (word-initial)
        ['quick', ['K', 'W', 'IH', 'K']], // qu + ck
        ['bank', ['B', 'AE', 'NG', 'K']], // nk
        ['filth', ['F', 'IH', 'L', 'TH']], // th (word-final)
        ['whip', ['W', 'IH', 'P']], // wh
        ['phony', ['F', 'AA', 'N', 'IY']], // ph + y-final
        ['sighed', ['S', 'IH', 'EH', 'D']], // gh silent, mid-word (not final-e)

        // ── Vowel digraphs ────────────────────────────────────────────────────
        ['aid', ['EY', 'D']], // ai
        ['clay', ['K', 'L', 'EY']], // ay
        ['haul', ['HH', 'AO', 'L']], // au
        ['crawl', ['K', 'R', 'AO', 'L']], // aw
        ['creed', ['K', 'R', 'IY', 'D']], // ee
        ['heap', ['HH', 'IY', 'P']], // ea
        ['feud', ['F', 'Y', 'UW', 'D']], // eu
        ['zeit', ['Z', 'EY', 'T']], // ei
        ['soak', ['S', 'OW', 'K']], // oa
        ['foe', ['F', 'OW']], // oe
        ['coin', ['K', 'OY', 'N']], // oi
        ['pouch', ['P', 'AW', 'CH']], // ou (+ ch, which pre-empts c-soft/hard)
        ['toy', ['T', 'OY']], // oy
        ['blue', ['B', 'L', 'UW']], // ue

        // ── Defaults (single vowels / consonants not covered above) ─────────
        ['kit', ['K', 'IH', 'T']], // default k (no ck/kn/qu match)
        ['qat', ['K', 'AE', 'T']], // default q (no qu match)

        // ── Unmapped characters ───────────────────────────────────────────────
        ['b2b', ['B', 'B']], // digit has no grapheme rule -> silently skipped, no phoneme emitted
        ['café', ['K', 'AE', 'F']], // non-ASCII letter has no grapheme rule -> silently skipped
    ])('phonemizes %j as %j', (word, expected) => {
        expect(g2pPhonemes(word)).toEqual(expected);
    });
});

describe('phonemize — exception dictionary', () => {
    it('resolves function words directly from the dictionary instead of the rule engine', () => {
        expect(g2pPhonemes('the')).toEqual(['DH', 'AH']);
        expect(g2pPhonemes('dont')).toEqual(['D', 'OW', 'N', 'T']);
    });

    it('looks up the dictionary case-insensitively', () => {
        expect(g2pPhonemes('THE')).toEqual(['DH', 'AH']);
        expect(g2pPhonemes('The')).toEqual(['DH', 'AH']);
    });
});

describe('phonemize — lyrics normalization', () => {
    it('returns a single silence unit for empty lyrics', () => {
        expect(phonemize({ lyrics: '', phonemeToId: {} })).toEqual({
            tokenIds: [0],
            phonemes: ['SP'],
            wordDiv: [1],
            wordIsSp: [true],
        });
    });

    it('returns a single silence unit for punctuation/whitespace-only lyrics', () => {
        expect(phonemize({ lyrics: '   ...!!!  ', phonemeToId: {} })).toEqual({
            tokenIds: [0],
            phonemes: ['SP'],
            wordDiv: [1],
            wordIsSp: [true],
        });
    });

    it('honors a custom silenceId on the empty-lyrics fallback', () => {
        expect(phonemize({ lyrics: '', phonemeToId: {}, silenceId: 7 })).toEqual({
            tokenIds: [7],
            phonemes: ['SP'],
            wordDiv: [1],
            wordIsSp: [true],
        });
    });

    it('wraps a single word with leading/trailing SP and reports word-unit metadata', () => {
        const result = phonemize({ lyrics: 'the', phonemeToId: {} });

        expect(result.phonemes).toEqual(['SP', 'DH', 'AH', 'SP']);
        expect(result.wordDiv).toEqual([1, 2, 1]);
        expect(result.wordIsSp).toEqual([true, false, true]);
    });

    it('inserts an SP unit between words but not after the last one before the trailing SP', () => {
        const result = phonemize({ lyrics: 'the cat', phonemeToId: {} });

        expect(result.phonemes).toEqual(['SP', 'DH', 'AH', 'SP', 'K', 'AE', 'T', 'SP']);
        expect(result.wordDiv).toEqual([1, 2, 1, 3, 1]);
        expect(result.wordIsSp).toEqual([true, false, true, false, true]);
    });

    it('is case-insensitive end to end', () => {
        const upper = phonemize({ lyrics: 'HELLO WORLD', phonemeToId: {} });
        const lower = phonemize({ lyrics: 'hello world', phonemeToId: {} });

        expect(upper).toEqual(lower);
        expect(upper.phonemes).toEqual(['SP', 'HH', 'AH', 'L', 'OW', 'SP', 'W', 'ER', 'L', 'D', 'SP']);
    });

    it('strips parens/quotes/comma/exclamation punctuation at word boundaries', () => {
        const result = phonemize({ lyrics: '(hello), "world"!', phonemeToId: {} });

        expect(result.phonemes).toEqual(['SP', 'HH', 'AH', 'L', 'OW', 'SP', 'W', 'ER', 'L', 'D', 'SP']);
    });

    it('splits on hyphens like any other word boundary', () => {
        const result = phonemize({ lyrics: 'long-lost', phonemeToId: {} });

        expect(result.phonemes).toEqual(['SP', 'L', 'AO', 'NG', 'SP', 'L', 'AO', 'S', 'T', 'SP']);
    });

    it('collapses runs of whitespace into a single word boundary', () => {
        const spaced = phonemize({ lyrics: 'hello   world', phonemeToId: {} });
        const single = phonemize({ lyrics: 'hello world', phonemeToId: {} });

        expect(spaced).toEqual(single);
    });

    // Documents a real behavior contract: the apostrophe is itself a splitting
    // character, so a literal apostrophe in "don't" produces two word-units
    // ("don" + "t") rather than hitting the apostrophe-free "dont" dictionary
    // entry. Only pre-stripped contractions ("dont") resolve via the dictionary.
    it('splits contractions on a literal apostrophe rather than stripping it', () => {
        const result = phonemize({ lyrics: "don't stop", phonemeToId: {} });

        // "don" (not in the dictionary) falls through to the G2P engine; "t" is
        // a single default-consonant word-unit; "stop" resolves from the dictionary.
        expect(result.phonemes).toEqual(['SP', 'D', 'AA', 'N', 'SP', 'T', 'SP', 'S', 'T', 'AA', 'P', 'SP']);
        expect(result.wordDiv).toEqual([1, 3, 1, 1, 1, 4, 1]);
    });
});

describe('phonemize — token id resolution', () => {
    it('maps phonemes present in phonemeToId and falls back to silenceId for the rest', () => {
        const result = phonemize({
            lyrics: 'hello',
            phonemeToId: { SP: 1, HH: 2, AH: 3 },
            silenceId: 99,
        });

        // phonemes: SP, HH, AH, L, OW, SP — L and OW are absent from the map.
        expect(result.phonemes).toEqual(['SP', 'HH', 'AH', 'L', 'OW', 'SP']);
        expect(result.tokenIds).toEqual([1, 2, 3, 99, 99, 1]);
    });

    it('defaults silenceId to 0 when omitted', () => {
        const result = phonemize({ lyrics: 'hi', phonemeToId: { HH: 5 } });

        // phonemes: SP, HH, IH, SP — SP and IH are absent from the map, so they fall back to 0.
        expect(result.tokenIds).toEqual([0, 5, 0, 0]);
    });
});

describe('parsePhonemesTxt', () => {
    it('maps each non-blank line to its line index', () => {
        expect(parsePhonemesTxt('SP\nAH\nB\n')).toEqual({ SP: 0, AH: 1, B: 2 });
    });

    it('trims whitespace and skips blank lines', () => {
        expect(parsePhonemesTxt('SP\n\n  AH  \n\n   \nB\n')).toEqual({ SP: 0, AH: 1, B: 2 });
    });

    it('handles content with no trailing newline', () => {
        expect(parsePhonemesTxt('SP\nAH')).toEqual({ SP: 0, AH: 1 });
    });

    it('returns an empty map for empty content', () => {
        expect(parsePhonemesTxt('')).toEqual({});
    });

    it('returns an empty map for whitespace/blank-line-only content', () => {
        expect(parsePhonemesTxt('\n\n   \n\t\n')).toEqual({});
    });
});
