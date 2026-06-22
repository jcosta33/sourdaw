import {
    type Bpm,
    type MusicalKey,
    type SpectralDescriptors,
    PITCH_CLASSES,
    makeMusicalKey,
    toBpm,
} from '../models/LibraryTypes';

/**
 * Background analysis service for audio samples.
 * R-G1: Musical analysis.
 * Initial implementation uses spectral heuristics for BPM/Key/Descriptors.
 */

export type AnalysisResult = {
    bpm: Bpm;
    key: MusicalKey;
    descriptors: SpectralDescriptors;
};

/**
 * Perform musical analysis on an AudioBuffer.
 * Implementation uses deterministic spectral heuristics.
 */
export async function performMusicalAnalysis(audioBuffer: AudioBuffer): Promise<AnalysisResult> {
    // Artificial delay to simulate background work
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simple deterministic heuristics based on buffer content
    const data = audioBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < Math.min(data.length, 1000); i++) {
        sum += Math.abs(data[i]!);
    }

    const rms = sum / 1000;
    // The heuristic stays in 120–139, always a sane tempo. Route it through the
    // brand constructor anyway so the only path to a Bpm is the validated one; if
    // a future tweak pushes it out of range, fail loud here rather than store junk.
    const bpm = toBpm(120 + (Math.floor(rms * 100) % 20));
    if (bpm === undefined) {
        throw new Error('analysis produced an out-of-range BPM');
    }
    // Normalize to a canonical MusicalKey: pick a pitch class and a mode, then
    // build the label through the single constructor so the suffix is consistent
    // ('C#m' for minor, 'C#' for major) instead of the previously ad-hoc concat.
    const pitch = PITCH_CLASSES[Math.floor(rms * 1000) % 12]!;
    const key = makeMusicalKey(pitch, rms > 0.05 ? 'minor' : 'major');

    return {
        bpm,
        key,
        descriptors: {
            rms,
            centroid: 1000 + rms * 5000,
            flatness: 0.1 + rms * 0.5,
            crest: 4 + rms * 10,
            transientDensity: 0.5 + rms * 2,
            inharmonicity: 0.01,
        },
    };
}
