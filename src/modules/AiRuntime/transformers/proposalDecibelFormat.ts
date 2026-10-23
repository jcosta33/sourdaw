import { type GainDbFormat } from '#/utils/audioLevelLaw';

/**
 * How a proposal states a decibel figure to the musician: two trimmed decimals, so prose reads `0 dB`
 * rather than the mixer's `0.0 dB` and a -1.25 dB change is never shown as -1.3 dB. The card's labels
 * and the diff of a refined card read it from here, so the two cannot disagree about one value.
 */
export const PROPOSAL_DECIBEL_FORMAT: GainDbFormat = { fractionDigits: 2, trimTrailingZeros: true };
