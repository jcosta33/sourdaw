import { R128_TARGET_LUFS } from '#/utils/audioLevelLaw';

import { type MixAnalysis } from '../../../models/MixComparisonTypes';

/**
 * The built-in mastered-mix target. These constants are a deliberately
 * specified style goal a user may aim at — they describe no measured recording,
 * and every comparison against them is labelled `referenceKind:
 * 'specified-target'` so target-chasing is never mistaken for matching a real
 * reference track. The LUFS goal is the export normalizer's own target, so a
 * mix the exporter just delivered is never flagged as over-target here.
 */
export function createReferenceAnalysis(): MixAnalysis {
    return {
        rmsDb: -12,
        peakDb: -1,
        lufs: R128_TARGET_LUFS,
        frequencyProfile: {
            sub: 0.4,
            bass: 0.65,
            'low-mid': 0.55,
            mid: 0.7,
            'high-mid': 0.65,
            presence: 0.6,
            air: 0.45,
        },
        stereoWidth: 0.65,
        dynamicRange: 8,
        crestFactor: 5,
    };
}
