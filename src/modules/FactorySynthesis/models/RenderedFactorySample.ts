export type FactorySampleCategory = 'drums' | 'bass' | 'keys' | 'vocal-loop' | 'fx';

/** A synthesized factory sample as raw PCM, before any AudioBuffer exists. Mono samples carry one channel. */
export type RenderedFactorySample = {
    id: string;
    name: string;
    category: FactorySampleCategory;
    tags: string[];
    bpm?: number;
    pitch?: number;
    channels: Float32Array[];
    sampleRate: number;
};
