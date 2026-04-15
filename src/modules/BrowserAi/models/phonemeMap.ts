/**
 * Default English phoneme → token ID map for standard DiffSinger English voicebanks.
 *
 * Follows the CMU ARPAbet subset used by Opencpop-style English voicebanks:
 * SP (silence) = 0, AP (breath) = 1, then CMU ARPAbet phonemes.
 *
 * Prefer loading the voicebank's own phonemes.txt via parsePhonemesTxt() when
 * available — use this map as a fallback before voicebank metadata loading is
 * fully implemented.
 */
export const DEFAULT_EN_PHONEME_MAP: Record<string, number> = {
    SP: 0, AP: 1,
    AA: 2, AE: 3, AH: 4, AO: 5, AW: 6, AY: 7,
    B: 8, CH: 9, D: 10, DH: 11,
    EH: 12, ER: 13, EY: 14,
    F: 15, G: 16, HH: 17,
    IH: 18, IY: 19,
    JH: 20, K: 21, L: 22, M: 23, N: 24, NG: 25,
    OW: 26, OY: 27, P: 28, R: 29, S: 30, SH: 31,
    T: 32, TH: 33, UH: 34, UW: 35,
    V: 36, W: 37, Y: 38, Z: 39, ZH: 40,
};
