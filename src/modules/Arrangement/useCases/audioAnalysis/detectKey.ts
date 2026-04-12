import { summarizeFeatures } from '#/modules/AudioAnalysis/useCases';
import { NOTE_NAMES } from '#/utils/noteNames';
import { getBufferForClip } from './helpers';

// ── Key Detection (Krumhansl-Schmuckler algorithm) ──────────────────────

/**
 * Krumhansl-Schmuckler key profiles.
 * Twelve values per profile representing the "fit" of each pitch class
 * (C, C#, D, D#, E, F, F#, G, G#, A, A#, B) in a given key.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;

    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = (x[i] ?? 0) - meanX;
        const dy = (y[i] ?? 0) - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }

    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
}

function rotateArray(arr: number[], offset: number): number[] {
    const n = arr.length;
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
        result.push(arr[(i + offset) % n] ?? 0);
    }
    return result;
}

export async function detectKey(clipId: string): Promise<string | null> {
    const result = getBufferForClip(clipId);
    if (!result) {
        return null;
    }

    // Use Meyda's chroma feature extraction via summarizeFeatures
    const summary = summarizeFeatures(result.audioBufferId);
    if (!summary || summary.chromaProfile.length !== 12) {
        // Fallback if Meyda analysis fails
        return 'C Major';
    }

    const chroma = summary.chromaProfile;

    // Correlate the chroma profile against all 24 major/minor key profiles
    let bestKey = 'C Major';
    let bestCorr = -Infinity;

    for (let root = 0; root < 12; root++) {
        const rotatedChroma = rotateArray(chroma, root);

        const majorCorr = pearsonCorrelation(rotatedChroma, MAJOR_PROFILE);
        if (majorCorr > bestCorr) {
            bestCorr = majorCorr;
            bestKey = `${NOTE_NAMES[root]!} Major`;
        }

        const minorCorr = pearsonCorrelation(rotatedChroma, MINOR_PROFILE);
        if (minorCorr > bestCorr) {
            bestCorr = minorCorr;
            bestKey = `${NOTE_NAMES[root]!} Minor`;
        }
    }

    return bestKey;
}