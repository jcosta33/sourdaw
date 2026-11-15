import { formatGainDb } from '#/utils/audioLevelLaw';

import { PROPOSAL_DECIBEL_FORMAT } from '../../transformers/proposalDecibelFormat';

/**
 * The confirmation prose's dB readout. The conversion and the `-∞` branch come
 * from the shared level law rather than from a fourth copy of the arithmetic
 * here — a confirmation sentence free to drift from the strip the user is
 * about to look at is worse than no sentence. Its precision is the refined
 * card's diff's: two trimmed decimals, since prose wants `0 dB`, not the
 * mixer's `0.0 dB`.
 */
export function formatDecibelsFromGain(value: number): string {
    return `${formatGainDb(value, PROPOSAL_DECIBEL_FORMAT)} dB`;
}
