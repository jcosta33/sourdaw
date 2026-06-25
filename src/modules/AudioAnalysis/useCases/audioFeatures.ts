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
 * Round a positive integer up to the nearest power of two.
 * Meyda's FFT requires a power-of-two window length; a non-power-of-two
 * `bufferSize` makes `Meyda.extract` throw (`notPow2`), so callers that pass
 * an arbitrary size still get a usable analysis window rather than a crash.
 */
function toPowerOfTwo(value: number): number {
    if (!Number.isFinite(value) || value < 1) {
        return 1;
    }
    return 2 ** Math.ceil(Math.log2(value));
}

/**
 * Extract per-frame audio features from a buffer using Meyda.
 * Returns an array of feature snapshots, one per analysis window.
 */
export function extractFeatures(audioBufferId: string, options: AnalysisOptions = {}): AudioFeatures[] {
    const { hopSize = 512 } = options;
    // Meyda's FFT only accepts power-of-two window lengths; anything else makes
    // Meyda.extract throw. Round the requested size up so an arbitrary
    // bufferSize still yields output instead of an exception.
    const bufferSize = toPowerOfTwo(options.bufferSize ?? 2048);

    const buffer = audioBufferCache.get(audioBufferId);
    if (!buffer) {
        return [];
    }

    const data = buffer.getChannelData(0);
    const frames: AudioFeatures[] = [];

    // Meyda's `extract` reads its sample rate and buffer size from the module
    // singleton. Snapshot the prior values and restore them after the run so a
    // call at one sample rate never leaves the globals reconfigured for the
    // next caller (which would otherwise extract against a stale sample rate /
    // buffer size). Restoring in `finally` keeps the config scoped to this call.
    const prevSampleRate = Meyda.sampleRate;
    const prevBufferSize = Meyda.bufferSize;
    Meyda.sampleRate = buffer.sampleRate;
    Meyda.bufferSize = bufferSize;

    try {
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
    } finally {
        Meyda.sampleRate = prevSampleRate;
        Meyda.bufferSize = prevBufferSize;
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

    const node = frames.length;

    const avgRms = frames.reduce((sum, freq) => sum + freq.rms, 0) / node;
    let peakRms = -Infinity;
    for (const freq of frames) {
        if (freq.rms > peakRms) {
            peakRms = freq.rms;
        }
    }
    const avgSpectralCentroid = frames.reduce((sum, freq) => sum + freq.spectralCentroid, 0) / node;
    const avgSpectralFlatness = frames.reduce((sum, freq) => sum + freq.spectralFlatness, 0) / node;
    const avgZcr = frames.reduce((sum, freq) => sum + freq.zcr, 0) / node;

    // Average chroma profile. Accumulate the raw per-frame sum first and divide
    // by the frame count once at the end; dividing inside the loop
    // (`chromaProfile[index] += chromaVal / node`) compounds floating-point
    // rounding error across every frame.
    const chromaProfile: number[] = Array.from({ length: 12 }).fill(0) as number[];
    for (const freq of frames) {
        for (let index = 0; index < 12; index++) {
            const chromaVal = freq.chroma[index] ?? 0;
            chromaProfile[index] = (chromaProfile[index] ?? 0) + chromaVal;
        }
    }
    for (let index = 0; index < 12; index++) {
        chromaProfile[index] = (chromaProfile[index] ?? 0) / node;
    }

    return {
        avgRms,
        peakRms,
        avgSpectralCentroid,
        avgSpectralFlatness,
        avgZcr,
        chromaProfile,
        frameCount: node,
    };
}
