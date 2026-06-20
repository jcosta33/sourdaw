/**
 * Service: Kokoro TTS tokenizer.
 *
 * Converts English text to Kokoro v1.0 ONNX model input_ids.
 *
 * Pipeline:
 *  1. Use the existing ARPAbet phonemizer (shared with DiffSinger) to get phoneme sequences.
 *  2. Map each ARPAbet phoneme → one or more Kokoro IPA token IDs via ARPABET_TO_KOKORO_IDS.
 *  3. Insert space token (16) between words; skip leading/trailing silence tokens.
 *  4. Wrap with pad tokens (0) at both ends — matches the Kokoro v1.0 input spec.
 *
 * Token vocabulary from onnx-community/Kokoro-82M-v1.0-ONNX tokenizer.json.
 * Spec §12. All exports are API-stable.
 */

import { logger } from '#/infra/logger/appLogger';

import { DEFAULT_EN_PHONEME_MAP } from '../models/phonemeMap';

import { phonemize } from './phonemizer';

/** Kokoro v1.0 context limit is 512 tokens including the two pad tokens. */
const MAX_PHONEME_TOKENS = 510;

/** Kokoro IPA token vocabulary (character → ID). */
export const KOKORO_VOCAB: Record<string, number> = {
    $: 0, // pad / boundary
    ';': 1,
    ':': 2,
    ',': 3,
    '.': 4,
    '!': 5,
    '?': 6,
    ' ': 16, // word boundary / space
    a: 43,
    b: 44,
    c: 45,
    d: 46,
    e: 47,
    f: 48,
    h: 50,
    i: 51,
    j: 52,
    k: 53,
    l: 54,
    m: 55,
    n: 56,
    o: 57,
    p: 58,
    q: 59,
    r: 60,
    s: 61,
    t: 62,
    u: 63,
    v: 64,
    w: 65,
    x: 66,
    y: 67,
    z: 68,
    // IPA vowels
    ɑ: 69,
    ɐ: 70,
    ɒ: 71,
    æ: 72,
    ɔ: 76,
    ə: 83,
    ɚ: 85,
    ɛ: 86,
    ɜ: 87,
    ɪ: 102,
    ɨ: 101,
    ɯ: 110,
    ø: 116,
    ʊ: 135,
    ʌ: 138,
    œ: 120,
    // IPA consonants
    β: 75,
    ɕ: 77,
    ç: 78,
    ɖ: 80,
    ð: 81,
    ʤ: 82,
    ɟ: 90,
    ɡ: 92,
    ɥ: 99,
    ʝ: 103,
    ŋ: 112,
    ɳ: 113,
    ɲ: 114,
    ɴ: 115,
    ɸ: 118,
    θ: 119,
    ɹ: 123,
    ɾ: 125,
    ɻ: 126,
    ʁ: 128,
    ɽ: 129,
    ʂ: 130,
    ʃ: 131,
    ʈ: 132,
    ʧ: 133,
    ʋ: 136,
    ɣ: 139,
    ɤ: 140,
    χ: 142,
    ʎ: 143,
    ʒ: 147,
    ʔ: 148,
    // Suprasegmentals
    ˈ: 156,
    ˌ: 157,
    ː: 158,
    ʰ: 162,
    ʲ: 164,
    // Affricates
    ʣ: 18,
    ʥ: 19,
    ʦ: 20,
    ʨ: 21,
};

/**
 * ARPAbet (CMU) phoneme → Kokoro IPA token ID(s).
 *
 * Diphthongs and affricates expand to two token IDs.
 * SP (DiffSinger silence) maps to a single space token (16).
 */
const ARPABET_TO_KOKORO_IDS: Record<string, number[]> = {
    SP: [16], // silence / word boundary → space
    AP: [16], // breath pause → space
    AA: [69], // ɑ  (father)
    AE: [72], // æ  (cat)
    AH: [138], // ʌ  (but) — use ʌ for both stressed & unstressed for simplicity
    AO: [76], // ɔ  (thought)
    AW: [43, 135], // aʊ (bout)
    AY: [43, 102], // aɪ (bite)
    B: [44], // b
    CH: [133], // ʧ  (cheese)
    D: [46], // d
    DH: [81], // ð  (the)
    EH: [86], // ɛ  (bed)
    ER: [85], // ɚ  (bird — rhotic schwa)
    EY: [47, 102], // eɪ (fate)
    F: [48], // f
    G: [92], // ɡ
    HH: [50], // h
    IH: [102], // ɪ  (bit)
    IY: [51], // i  (beet)
    JH: [82], // ʤ  (jog)
    K: [53], // k
    L: [54], // l
    M: [55], // m
    N: [56], // n
    NG: [112], // ŋ  (sing)
    OW: [57, 135], // oʊ (go)
    OY: [76, 102], // ɔɪ (boy)
    P: [58], // p
    R: [123], // ɹ  (red)
    S: [61], // s
    SH: [131], // ʃ  (shoe)
    T: [62], // t
    TH: [119], // θ  (thin)
    UH: [135], // ʊ  (book)
    UW: [63], // u  (boot)
    V: [64], // v
    W: [65], // w
    Y: [52], // j  (yes)
    Z: [68], // z
    ZH: [147], // ʒ  (measure)
};

type KokoroInputIds = {
    /** Padded token ID sequence: [0, ...phonemeIds, 0] as BigInt64Array */
    inputIds: BigInt64Array;
    /**
     * Number of phoneme tokens BEFORE padding.
     * Used to index the voice embedding file: style = voices[tokenCount] * shape [1,256].
     */
    tokenCount: number;
    /**
     * Non-fatal issues that altered the output: input truncated past the model's
     * context limit, or phonemes dropped because they are absent from the Kokoro
     * vocabulary. Empty when the text mapped cleanly. Callers can surface these to
     * the user instead of silently producing degraded audio.
     */
    warnings: string[];
};

/**
 * Convert English lyrics / text to Kokoro v1.0 input_ids.
 *
 * Returns the padded int64 token sequence and the pre-padding token count
 * needed to look up the correct voice embedding slice.
 */
export function textToKokoroInputIds(text: string): KokoroInputIds {
    const { phonemes } = phonemize({ lyrics: text, phonemeToId: DEFAULT_EN_PHONEME_MAP });

    const tokenIds: number[] = [];
    const warnings: string[] = [];
    const droppedPhonemes: string[] = [];

    for (let index = 0; index < phonemes.length; index++) {
        const ph = phonemes[index]!;
        const isLeadingOrTrailing = (index === 0 && ph === 'SP') || (index === phonemes.length - 1 && ph === 'SP');

        if (isLeadingOrTrailing) {
            // Skip boundary silences — Kokoro doesn't need explicit outer padding silences
            continue;
        }

        const ids = ARPABET_TO_KOKORO_IDS[ph];
        if (ids) {
            tokenIds.push(...ids);
        } else {
            // Unknown phonemes are dropped (shouldn't happen with a complete map),
            // but record them so the caller can flag degraded output instead of
            // silently mispronouncing the input.
            droppedPhonemes.push(ph);
        }
    }

    if (droppedPhonemes.length > 0) {
        const warning = `Kokoro tokenizer dropped ${String(droppedPhonemes.length)} phoneme(s) absent from the vocabulary: ${droppedPhonemes.join(', ')}`;
        warnings.push(warning);
        logger.warn(`[BrowserAi] ${warning}`);
    }

    if (tokenIds.length === 0) {
        throw new Error('Text produced no phonemes — cannot synthesize empty or whitespace-only input');
    }

    const tokenCount = tokenIds.length;

    if (tokenCount > MAX_PHONEME_TOKENS) {
        // Truncate so the padded sequence never exceeds the model's context limit.
        const dropped = tokenCount - MAX_PHONEME_TOKENS;
        tokenIds.splice(MAX_PHONEME_TOKENS);
        const warning = `Kokoro input truncated: ${String(tokenCount)} tokens exceeded the ${String(MAX_PHONEME_TOKENS)}-token limit, ${String(dropped)} dropped from the end`;
        warnings.push(warning);
        logger.warn(`[BrowserAi] ${warning}`);
    }

    // tokenCount above is the pre-truncation phoneme count; the voice-embedding
    // lookup must use the actual (possibly truncated) length.
    const effectiveTokenCount = tokenIds.length;

    // Wrap with pad token 0 at both ends (Kokoro v1.0 post-processor convention)
    const paddedIds = [0, ...tokenIds, 0];
    const inputIds = BigInt64Array.from(paddedIds.map(BigInt));

    return { inputIds, tokenCount: effectiveTokenCount, warnings };
}
