import { type MixAnalysis } from '#/modules/AudioAnalysis/models/MixComparisonTypes';

/**
 * Create a reference analysis (simulating a mastered track).
 */
export function createReferenceAnalysis(): MixAnalysis {
    return {
        rmsDb: -12,
        peakDb: -1,
        lufs: -14,
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