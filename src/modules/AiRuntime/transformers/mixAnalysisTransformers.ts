/**
 * Transformers: pure data transformations for mix analysis.
 * No I/O — only derive new data from existing data.
 */

import { type MixIssue, type MixAnalysis } from '../models/MixAnalysis';
import { type FrequencyBands } from '../repositories/mixAnalysis/readFrequencyBalance';

const SILENCE_FLOOR_DB = -100;

// ── Issue Detection ─────────────────────────────────────────────────────

export type DetectIssuesInput = {
    masterLevels: { peakDb: number; rmsDb: number };
    bands: FrequencyBands;
    trackLevels: MixAnalysis['trackLevels'];
};

export function detectIssues({ masterLevels, bands, trackLevels }: DetectIssuesInput): MixIssue[] {
    const issues: MixIssue[] = [];

    for (const tl of trackLevels) {
        if (tl.isClipping) {
            issues.push({
                severity: 'critical',
                category: 'level',
                message: `${tl.trackName} is clipping at ${tl.peakDb.toFixed(1)} dB`,
                trackId: tl.trackId,
            });
        }
    }

    if (masterLevels.peakDb > -3) {
        issues.push({
            severity: 'warning',
            category: 'level',
            message: `Master peak is ${masterLevels.peakDb.toFixed(1)} dB — low headroom`,
        });
    }

    const lowEnergy = (bands.sub + bands.bass) / 2;
    const highEnergy = (bands.mid + bands.high) / 2;
    if (lowEnergy - highEnergy > 6) {
        issues.push({
            severity: 'warning',
            category: 'frequency',
            message: `Mix is muddy — low-end energy exceeds mids/highs by ${(lowEnergy - highEnergy).toFixed(1)} dB`,
        });
    }

    if (bands.highMid - bands.mid > 6) {
        issues.push({
            severity: 'warning',
            category: 'frequency',
            message: `Mix is harsh — high-mid energy exceeds mids by ${(bands.highMid - bands.mid).toFixed(1)} dB`,
        });
    }

    for (const tl of trackLevels) {
        if (tl.isMuted) {
            issues.push({
                severity: 'info',
                category: 'level',
                message: `${tl.trackName} is muted`,
                trackId: tl.trackId,
            });
        }
    }

    const activeTracks = trackLevels.filter(
        (time: MixAnalysis['trackLevels'][number]) => !time.isMuted && time.peakDb > SILENCE_FLOOR_DB
    );
    if (activeTracks.length >= 2) {
        const peaks = activeTracks.map((time: MixAnalysis['trackLevels'][number]) => time.peakDb);
        const maxPeak = Math.max(...peaks);
        const minPeak = Math.min(...peaks);
        if (maxPeak - minPeak > 20) {
            const loudest = activeTracks.find((time: MixAnalysis['trackLevels'][number]) => time.peakDb === maxPeak);
            const quietest = activeTracks.find((time: MixAnalysis['trackLevels'][number]) => time.peakDb === minPeak);
            issues.push({
                severity: 'info',
                category: 'level',
                message: `Track levels differ by ${(maxPeak - minPeak).toFixed(1)} dB (${loudest?.trackName} vs ${quietest?.trackName})`,
            });
        }
    }

    return issues;
}

// ── Suggestion Generation ───────────────────────────────────────────────

export type GenerateSuggestionsInput = {
    masterLevels: { peakDb: number; rmsDb: number };
    bands: FrequencyBands;
    trackLevels: MixAnalysis['trackLevels'];
    issues: MixIssue[];
};

export function generateSuggestions({ masterLevels, bands, trackLevels, issues }: GenerateSuggestionsInput): string[] {
    const suggestions: string[] = [];

    for (const tl of trackLevels) {
        if (tl.isClipping) {
            const overshoot = tl.peakDb + 0.5;
            suggestions.push(`${tl.trackName} is clipping — reduce gain by at least ${overshoot.toFixed(1)} dB`);
        }
    }

    if (masterLevels.peakDb > -3) {
        const reduction = masterLevels.peakDb + 6;
        suggestions.push(
            `Master is hot at ${masterLevels.peakDb.toFixed(1)} dB — reduce by ${reduction.toFixed(1)} dB to leave headroom for mastering`
        );
    }

    const lowEnergy = (bands.sub + bands.bass) / 2;
    const highEnergy = (bands.mid + bands.high) / 2;
    if (lowEnergy - highEnergy > 6) {
        suggestions.push('Consider applying a high-pass filter on non-bass tracks to reduce low-end buildup');
    }

    if (bands.highMid - bands.mid > 6) {
        suggestions.push('Consider a gentle cut around 2–6 kHz on bright tracks to tame harshness');
    }

    if (issues.length === 0) {
        suggestions.push('Mix has good frequency balance and healthy levels');
    }

    return suggestions;
}
