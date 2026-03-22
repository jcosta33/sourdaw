/**
 * AI Reference Mix Comparison
 *
 * Analyzes the current mix against a reference track to provide
 * actionable feedback on frequency balance, dynamics, stereo width,
 * and loudness matching.
 */

import { trackStore } from '#/modules/Track/stores/trackStore';

export type FrequencyBand = 'sub' | 'bass' | 'low-mid' | 'mid' | 'high-mid' | 'presence' | 'air';

export type MixAnalysis = {
    /** RMS level in dBFS */
    rmsDb: number;
    /** Peak level in dBFS */
    peakDb: number;
    /** Integrated loudness in LUFS */
    lufs: number;
    /** Frequency band energy distribution (0–1 for each band) */
    frequencyProfile: Record<FrequencyBand, number>;
    /** Stereo width (0 = mono, 1 = wide stereo) */
    stereoWidth: number;
    /** Dynamic range in dB */
    dynamicRange: number;
    /** Crest factor (peak-to-RMS ratio in dB) */
    crestFactor: number;
};

export type MixComparisonResult = {
    /** Overall similarity score (0–100) */
    overallScore: number;
    /** Category-specific scores */
    scores: {
        frequency: number;
        dynamics: number;
        loudness: number;
        stereoWidth: number;
    };
    /** Actionable suggestions */
    suggestions: MixSuggestion[];
    /** Reference analysis snapshot */
    referenceAnalysis: MixAnalysis;
    /** Current mix analysis snapshot */
    currentAnalysis: MixAnalysis;
    /** Timestamp */
    analyzedAt: string;
};

export type MixSuggestion = {
    category: 'frequency' | 'dynamics' | 'loudness' | 'stereo' | 'general';
    severity: 'info' | 'warning' | 'critical';
    message: string;
    /** Specific actionable fix */
    action: string;
    /** Which frequency band or parameter to adjust */
    target?: string;
    /** How much to adjust (in dB or %) */
    adjustment?: number;
};

const FREQUENCY_RANGES: Record<FrequencyBand, [number, number]> = {
    sub: [20, 60],
    bass: [60, 250],
    'low-mid': [250, 500],
    mid: [500, 2000],
    'high-mid': [2000, 4000],
    presence: [4000, 8000],
    air: [8000, 20000],
};

/**
 * Analyze a mix based on track configuration.
 * In production this would use actual audio analysis;
 * here we derive estimates from track gain/pan/device settings.
 */
export function analyzeMix(): MixAnalysis {
    const state = trackStore.value;
    if (!state) {
        return createDefaultAnalysis();
    }

    const tracks = state.tracks.filter((t) => !t.muted && t.kind !== 'folder');
    const trackCount = tracks.length || 1;

    // Estimate RMS from track gains
    const gains = tracks.map((t) => t.gain ?? 0);
    const avgGain = gains.reduce((a, b) => a + b, 0) / trackCount;
    const rmsDb = Math.max(-60, avgGain - 6);
    const peakDb = Math.max(-60, avgGain - 1);
    const lufs = rmsDb - 3; // rough approximation

    // Estimate frequency profile from track types and EQ presence
    const frequencyProfile = estimateFrequencyProfile(tracks);

    // Estimate stereo width from pan positions
    const pans = tracks.map((t) => Math.abs(t.pan ?? 0));
    const stereoWidth = pans.length > 0 ? pans.reduce((a, b) => a + b, 0) / pans.length : 0.5;

    const dynamicRange = Math.min(20, Math.max(3, 14 - trackCount * 0.5));
    const crestFactor = dynamicRange * 0.7;

    return {
        rmsDb,
        peakDb,
        lufs,
        frequencyProfile,
        stereoWidth,
        dynamicRange,
        crestFactor,
    };
}

function estimateFrequencyProfile(tracks: Array<{ kind: string; gain?: number }>): Record<FrequencyBand, number> {
    const profile: Record<FrequencyBand, number> = {
        sub: 0.3,
        bass: 0.5,
        'low-mid': 0.6,
        mid: 0.7,
        'high-mid': 0.6,
        presence: 0.5,
        air: 0.3,
    };

    // Adjust based on track composition
    const midiTracks = tracks.filter((t) => t.kind === 'midi').length;
    const audioTracks = tracks.filter((t) => t.kind === 'audio').length;
    const totalTracks = tracks.length || 1;

    if (midiTracks / totalTracks > 0.5) {
        profile.mid += 0.15;
        profile['high-mid'] += 0.1;
    }
    if (audioTracks / totalTracks > 0.5) {
        profile.bass += 0.1;
        profile['low-mid'] += 0.1;
    }

    // Normalize to 0-1
    const max = Math.max(...Object.values(profile));
    for (const band of Object.keys(profile) as FrequencyBand[]) {
        profile[band] = Math.min(1, profile[band]! / max);
    }

    return profile;
}

function createDefaultAnalysis(): MixAnalysis {
    return {
        rmsDb: -18,
        peakDb: -6,
        lufs: -14,
        frequencyProfile: { sub: 0.3, bass: 0.5, 'low-mid': 0.6, mid: 0.7, 'high-mid': 0.6, presence: 0.5, air: 0.3 },
        stereoWidth: 0.5,
        dynamicRange: 10,
        crestFactor: 7,
    };
}

/**
 * Create a reference analysis (simulating a mastered track).
 */
export function createReferenceAnalysis(): MixAnalysis {
    return {
        rmsDb: -12,
        peakDb: -1,
        lufs: -14,
        frequencyProfile: { sub: 0.4, bass: 0.65, 'low-mid': 0.55, mid: 0.7, 'high-mid': 0.65, presence: 0.6, air: 0.45 },
        stereoWidth: 0.65,
        dynamicRange: 8,
        crestFactor: 5,
    };
}

/**
 * Compare current mix against a reference and generate suggestions.
 */
export function compareMixes(reference: MixAnalysis, current: MixAnalysis): MixComparisonResult {
    const suggestions: MixSuggestion[] = [];

    // ── Loudness comparison ─────────────────────────────────
    const lufsDiff = current.lufs - reference.lufs;
    let loudnessScore = 100;
    if (Math.abs(lufsDiff) > 1) {
        loudnessScore = Math.max(0, 100 - Math.abs(lufsDiff) * 10);
        suggestions.push({
            category: 'loudness',
            severity: Math.abs(lufsDiff) > 4 ? 'critical' : 'warning',
            message: lufsDiff > 0
                ? `Mix is ${lufsDiff.toFixed(1)} LUFS louder than reference`
                : `Mix is ${Math.abs(lufsDiff).toFixed(1)} LUFS quieter than reference`,
            action: lufsDiff > 0
                ? 'Reduce master bus gain or add a limiter with lower ceiling'
                : 'Increase master bus gain or raise limiter threshold',
            adjustment: -lufsDiff,
        });
    }

    // ── Frequency comparison ────────────────────────────────
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
                message: diff > 0
                    ? `${band} band (${range[0]}–${range[1]} Hz) is ${(diff * 100).toFixed(0)}% higher than reference`
                    : `${band} band (${range[0]}–${range[1]} Hz) is ${(Math.abs(diff) * 100).toFixed(0)}% lower than reference`,
                action: diff > 0
                    ? `Cut ${band} band by ~${(Math.abs(diff) * 6).toFixed(1)} dB on master EQ`
                    : `Boost ${band} band by ~${(Math.abs(diff) * 6).toFixed(1)} dB on master EQ`,
                target: band,
                adjustment: -diff * 6,
            });
        }
    }
    freqScore = Math.max(0, freqScore);

    // ── Dynamics comparison ─────────────────────────────────
    const drDiff = current.dynamicRange - reference.dynamicRange;
    let dynamicsScore = Math.max(0, 100 - Math.abs(drDiff) * 8);
    if (Math.abs(drDiff) > 2) {
        suggestions.push({
            category: 'dynamics',
            severity: Math.abs(drDiff) > 5 ? 'critical' : 'warning',
            message: drDiff > 0
                ? `Dynamic range is ${drDiff.toFixed(1)} dB wider than reference`
                : `Dynamic range is ${Math.abs(drDiff).toFixed(1)} dB narrower than reference`,
            action: drDiff > 0
                ? 'Add bus compression to tighten dynamics'
                : 'Reduce compression to restore dynamics',
        });
    }

    // ── Stereo width comparison ─────────────────────────────
    const swDiff = current.stereoWidth - reference.stereoWidth;
    let stereoScore = Math.max(0, 100 - Math.abs(swDiff) * 150);
    if (Math.abs(swDiff) > 0.1) {
        suggestions.push({
            category: 'stereo',
            severity: Math.abs(swDiff) > 0.25 ? 'warning' : 'info',
            message: swDiff > 0
                ? 'Stereo image is wider than reference'
                : 'Stereo image is narrower than reference',
            action: swDiff > 0
                ? 'Narrow some tracks by reducing pan extremes or adding mono-maker to sub frequencies'
                : 'Widen the mix by panning instruments further apart or adding stereo widener',
        });
    }

    const overallScore = Math.round(
        (loudnessScore * 0.3 + freqScore * 0.35 + dynamicsScore * 0.2 + stereoScore * 0.15)
    );

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
