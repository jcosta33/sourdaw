import {
    type FrequencyBand,
    type MixAnalysis,
    type MixComparisonResult,
    type MixSuggestion,
    FREQUENCY_RANGES,
} from '#/modules/AudioAnalysis/models/MixComparisonTypes';
import { analyzeMix, createReferenceAnalysis } from './analyzeMix';

/**
 * Compare current mix against a reference and generate suggestions.
 */
export function compareMixes(reference: MixAnalysis, current: MixAnalysis): MixComparisonResult {
    const suggestions: MixSuggestion[] = [];

    // ── Loudness comparison
    const lufsDiff = current.lufs - reference.lufs;
    let loudnessScore = 100;
    if (Math.abs(lufsDiff) > 1) {
        loudnessScore = Math.max(0, 100 - Math.abs(lufsDiff) * 10);
        suggestions.push({
            category: 'loudness',
            severity: Math.abs(lufsDiff) > 4 ? 'critical' : 'warning',
            message:
                lufsDiff > 0
                    ? `Mix is ${lufsDiff.toFixed(1)} LUFS louder than reference`
                    : `Mix is ${Math.abs(lufsDiff).toFixed(1)} LUFS quieter than reference`,
            action:
                lufsDiff > 0
                    ? 'Reduce master bus gain or add a limiter with lower ceiling'
                    : 'Increase master bus gain or raise limiter threshold',
            adjustment: -lufsDiff,
        });
    }

    // ── Frequency comparison
    let freqScore = 100;
    const bands = Object.keys(reference.frequencyProfile) as FrequencyBand[];
    for (const band of bands) {
        const diff = current.frequencyProfile[band]! - reference.frequencyProfile[band]!;
        freqScore -= Math.abs(diff) * 30;
        if (Math.abs(diff) > 0.15) {
            const range = FREQUENCY_RANGES[band];
            suggestions.push({
                category: 'frequency',
                severity: Math.abs(diff) > 0.25 ? 'warning' : 'info',
                message:
                    diff > 0
                        ? `${band} band (${range[0]}–${range[1]} Hz) is ${(diff * 100).toFixed(0)}% higher than reference`
                        : `${band} band (${range[0]}–${range[1]} Hz) is ${(Math.abs(diff) * 100).toFixed(0)}% lower than reference`,
                action:
                    diff > 0
                        ? `Cut ${band} band by ~${(Math.abs(diff) * 6).toFixed(1)} dB on master EQ`
                        : `Boost ${band} band by ~${(Math.abs(diff) * 6).toFixed(1)} dB on master EQ`,
                target: band,
                adjustment: -diff * 6,
            });
        }
    }
    freqScore = Math.max(0, freqScore);

    // ── Dynamics comparison
    const drDiff = current.dynamicRange - reference.dynamicRange;
    const dynamicsScore = Math.max(0, 100 - Math.abs(drDiff) * 8);
    if (Math.abs(drDiff) > 2) {
        suggestions.push({
            category: 'dynamics',
            severity: Math.abs(drDiff) > 5 ? 'critical' : 'warning',
            message:
                drDiff > 0
                    ? `Dynamic range is ${drDiff.toFixed(1)} dB wider than reference`
                    : `Dynamic range is ${Math.abs(drDiff).toFixed(1)} dB narrower than reference`,
            action: drDiff > 0 ? 'Add bus compression to tighten dynamics' : 'Reduce compression to restore dynamics',
        });
    }

    // ── Stereo width comparison
    const swDiff = current.stereoWidth - reference.stereoWidth;
    const stereoScore = Math.max(0, 100 - Math.abs(swDiff) * 150);
    if (Math.abs(swDiff) > 0.1) {
        suggestions.push({
            category: 'stereo',
            severity: Math.abs(swDiff) > 0.25 ? 'warning' : 'info',
            message: swDiff > 0 ? 'Stereo image is wider than reference' : 'Stereo image is narrower than reference',
            action:
                swDiff > 0
                    ? 'Narrow some tracks by reducing pan extremes or adding mono-maker to sub frequencies'
                    : 'Widen the mix by panning instruments further apart or adding stereo widener',
        });
    }

    const overallScore = Math.round(loudnessScore * 0.3 + freqScore * 0.35 + dynamicsScore * 0.2 + stereoScore * 0.15);

    return {
        overallScore,
        scores: {
            frequency: Math.round(freqScore),
            dynamics: Math.round(dynamicsScore),
            loudness: Math.round(loudnessScore),
            stereoWidth: Math.round(stereoScore),
        },
        suggestions: suggestions.sort((a, b) => {
            const sev = { critical: 0, warning: 1, info: 2 };
            return sev[a.severity] - sev[b.severity];
        }),
        referenceAnalysis: reference,
        currentAnalysis: current,
        analyzedAt: new Date().toISOString(),
    };
}

/**
 * Run full comparison against a default mastered reference.
 */
export function compareToReference(): MixComparisonResult {
    const current = analyzeMix();
    const reference = createReferenceAnalysis();
    return compareMixes(reference, current);
}
