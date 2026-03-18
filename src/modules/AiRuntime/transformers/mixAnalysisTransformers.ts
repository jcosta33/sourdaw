/**
 * Transformers: pure data transformations for mix analysis.
 * No I/O — only derive new data from existing data.
 */

import { type MixIssue, type MixAnalysis } from '../models/MixAnalysis';
import { type FrequencyBands } from '../repositories/mixAnalysisRepository';

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
        (t: MixAnalysis['trackLevels'][number]) => !t.isMuted && t.peakDb > SILENCE_FLOOR_DB
    );
    if (activeTracks.length >= 2) {
        const peaks = activeTracks.map((t: MixAnalysis['trackLevels'][number]) => t.peakDb);
        const maxPeak = Math.max(...peaks);
        const minPeak = Math.min(...peaks);
        if (maxPeak - minPeak > 20) {
            const loudest = activeTracks.find((t: MixAnalysis['trackLevels'][number]) => t.peakDb === maxPeak);
            const quietest = activeTracks.find((t: MixAnalysis['trackLevels'][number]) => t.peakDb === minPeak);
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

// ── Formatting ──────────────────────────────────────────────────────────

export function formatMixAnalysis(result: MixAnalysis): string {
    const lines: string[] = [];

    lines.push('=== Mix Analysis ===');
    lines.push(
        `Master: peak ${result.overallLevel.peakDb.toFixed(1)} dB, RMS ${result.overallLevel.rmsDb.toFixed(1)} dB`
    );
    lines.push('');

    lines.push('Frequency Balance:');
    lines.push(`  Sub  (20–60 Hz):     ${result.frequencyBalance.sub.toFixed(1)} dB`);
    lines.push(`  Bass (60–250 Hz):    ${result.frequencyBalance.bass.toFixed(1)} dB`);
    lines.push(`  Low-Mid (250–500):   ${result.frequencyBalance.lowMid.toFixed(1)} dB`);
    lines.push(`  Mid (500–2k):        ${result.frequencyBalance.mid.toFixed(1)} dB`);
    lines.push(`  High-Mid (2k–6k):    ${result.frequencyBalance.highMid.toFixed(1)} dB`);
    lines.push(`  High (6k–20k):       ${result.frequencyBalance.high.toFixed(1)} dB`);
    lines.push('');

    if (result.trackLevels.length > 0) {
        lines.push('Track Levels:');
        for (const tl of result.trackLevels) {
            const flags = [tl.isMuted ? 'MUTED' : null, tl.isSoloed ? 'SOLO' : null, tl.isClipping ? 'CLIP!' : null]
                .filter(Boolean)
                .join(' ');
            lines.push(`  ${tl.trackName}: peak ${tl.peakDb.toFixed(1)} dB, RMS ${tl.rmsDb.toFixed(1)} dB ${flags}`);
        }
        lines.push('');
    }

    if (result.issues.length > 0) {
        lines.push('Issues:');
        for (const issue of result.issues) {
            const icon = issue.severity === 'critical' ? '[!]' : issue.severity === 'warning' ? '[~]' : '[i]';
            lines.push(`  ${icon} ${issue.message}`);
        }
        lines.push('');
    }

    if (result.suggestions.length > 0) {
        lines.push('Suggestions:');
        for (const s of result.suggestions) {
            lines.push(`  • ${s}`);
        }
    }

    return lines.join('\n');
}
