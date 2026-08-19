import { invokeAI } from './invokeAI';

export type DenoiseResult = {
    samples: number[];
    noise_floor_db: number;
    processing_time_ms: number;
};

/**
 * Denoise audio through the native desktop command bridge.
 *
 * TODO: `Array.from(samples)` converts Float32Array to number[] for JSON
 * serialization over IPC — performance concern for large buffers.
 */
export async function denoiseAudio(
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    strength = 0.7
): Promise<DenoiseResult> {
    return (await invokeAI('denoise_audio', {
        request: {
            samples: Array.from(samples),
            sample_rate: sampleRate,
            channels,
            strength,
        },
    })) as DenoiseResult;
}
