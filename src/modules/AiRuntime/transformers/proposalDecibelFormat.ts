import { type GainDbFormat } from '#/utils/audioLevelLaw';

/**
 * How a refined card's diff and the confirmation prose state a decibel figure: two trimmed decimals, so
 * prose reads `0 dB` rather than the mixer's `0.0 dB`, and two values a refinement tells apart look
 * apart in its diff (-1.25 dB against -1.3 dB, -6 dB against -1.33 dB). The card's action labels keep
 * their own one-decimal readout, so a label may round a figure the diff states exactly.
 */
export const PROPOSAL_DECIBEL_FORMAT: GainDbFormat = { fractionDigits: 2, trimTrailingZeros: true };
