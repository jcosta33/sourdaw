import { extractFeatures, type AnalysisOptions, type AudioFeaturesSummary } from './audioFeatures';

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
