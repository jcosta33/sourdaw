/**
 * Use case: Audio feature extraction using Meyda.
 *
 * Provides spectral analysis, loudness metering, and timbral features
 * for audio clips. Used for automated mixing decisions, similarity
 * matching, and AI-assisted sound design.
 *
 * License: MIT (safe for commercial use).
 */

import Meyda from 'meyda';

import { audioBufferCache } from '#/modules/AudioEngine/stores';

// ── Types ───────────────────────────────────────────────────────────────

export type AudioFeatures = {
    rms: number;
    energy: number;
    spectralCentroid: number;
    spectralFlatness: number;
    spectralRolloff: number;
    zcr: number;
    loudness: { total: number; specific: Float32Array };
    mfcc: number[];
    chroma: number[];
};

export type AudioFeaturesSummary = {
    /** Average RMS level (0-1 range) */
    avgRms: number;
    /** Peak RMS level */
    peakRms: number;
    /** Average spectral centroid in Hz (brightness) */
    avgSpectralCentroid: number;
    /** Average spectral flatness (0=tonal, 1=noisy) */
    avgSpectralFlatness: number;
    /** Average zero crossing rate (higher = noisier/brighter) */
    avgZcr: number;
    /** Chroma profile (12-element array, average energy per pitch class) */
    chromaProfile: number[];
    /** Number of analysis frames */
    frameCount: number;
};

export type AnalysisOptions = {
    /** FFT size (default 2048) */
    bufferSize?: number;
    /** Hop size (default 512) */
    hopSize?: number;
};

// ── Feature extraction ──────────────────────────────────────────────────

/**
 * Extract per-frame audio features from a buffer using Meyda.
 * Returns an array of feature snapshots, one per analysis window.
 */
export function extractFeatures(audioBufferId: string, options: AnalysisOptions = {}): AudioFeatures[] {
    const { bufferSize = 2048, hopSize = 512 } = options;

    const buffer = audioBufferCache.get(audioBufferId);
    if (!buffer) {
        return [];
    }

    const data = buffer.getChannelData(0);
    const frames: AudioFeatures[] = [];

    // Set Meyda global config (extract reads from these)
    Meyda.sampleRate = buffer.sampleRate;
    Meyda.bufferSize = bufferSize;

    // Reuse one window buffer across all hops instead of allocating a new
    // Float32Array(bufferSize) per iteration (§70.1). At bufferSize=2048
    // and ~50% overlap that was ~1.5k allocations per second of audio.
    const window = new Float32Array(bufferSize);

    for (let offset = 0; offset + bufferSize <= data.length; offset += hopSize) {
        window.set(data.subarray(offset, offset + bufferSize));

        const features = Meyda.extract(
            [
                'rms',
                'energy',
                'spectralCentroid',
                'spectralFlatness',
                'spectralRolloff',
                'zcr',
                'loudness',
                'mfcc',
                'chroma',
            ],
            window
        );

        if (features) {
            frames.push({
                rms: (features.rms as number) ?? 0,
                energy: (features.energy as number) ?? 0,
                spectralCentroid: (features.spectralCentroid as number) ?? 0,
                spectralFlatness: (features.spectralFlatness as number) ?? 0,
                spectralRolloff: (features.spectralRolloff as number) ?? 0,
                zcr: (features.zcr as number) ?? 0,
                loudness: (features.loudness as { total: number; specific: Float32Array }) ?? {
                    total: 0,
                    specific: new Float32Array(0),
                },
                mfcc: (features.mfcc as number[]) ?? [],
                chroma: (features.chroma as number[]) ?? [],
            });
        }
    }

    return frames;
}

/**
 * Compute a summary of audio features across the entire buffer.
 * Useful for quick analysis and comparison between clips.
 */
export function summarizeFeatures(audioBufferId: string, options?: AnalysisOptions): AudioFeaturesSummary | null {
    const frames = extractFeatures(audioBufferId, options);
    if (frames.length === 0) {
        return null;
    }

    const n = frames.length;

    const avgRms = frames.reduce((sum, f) => sum + f.rms, 0) / n;
    let peakRms = -Infinity;
    for (const f of frames) {
        if (f.rms > peakRms) {
            peakRms = f.rms;
        }
    }
    const avgSpectralCentroid = frames.reduce((sum, f) => sum + f.spectralCentroid, 0) / n;
    const avgSpectralFlatness = frames.reduce((sum, f) => sum + f.spectralFlatness, 0) / n;
    const avgZcr = frames.reduce((sum, f) => sum + f.zcr, 0) / n;

    // Average chroma profile
    const chromaProfile: number[] = Array.from({ length: 12 }).fill(0) as number[];
    for (const f of frames) {
        for (let i = 0; i < 12; i++) {
            const chromaVal = f.chroma[i] ?? 0;
            chromaProfile[i] = (chromaProfile[i] ?? 0) + chromaVal / n;
        }
    }

    return {
        avgRms,
        peakRms,
        avgSpectralCentroid,
        avgSpectralFlatness,
        avgZcr,
        chromaProfile,
        frameCount: n,
    };
}
