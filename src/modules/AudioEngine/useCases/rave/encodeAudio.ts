import { type LatentVector } from '#/modules/AudioEngine/stores/rave';

/**
 * Encode audio samples into latent space vectors.
 * In production this calls the ONNX encoder model.
 * Here we simulate with a deterministic spectral transform.
 *
 * Pure transform — callers should update raveStore.latentCache if needed.
 */
export function encodeAudio(samples: Float32Array, sampleRate: number, latentDim: number = 16): LatentVector[] {
    const frameSize = Math.floor(sampleRate * 0.02); // 20ms frames
    const vectors: LatentVector[] = [];

    for (let i = 0; i < samples.length - frameSize; i += frameSize) {
        const values: number[] = [];
        for (let d = 0; d < latentDim; d++) {
            let sum = 0;
            const stride = Math.floor(frameSize / latentDim);
            for (let j = 0; j < stride; j++) {
                const idx = i + d * stride + j;
                if (idx < samples.length) {
                    sum += samples[idx]! * Math.sin((d + 1) * j * 0.1);
                }
            }
            values.push(Math.tanh(sum * 10));
        }

        vectors.push({
            values,
            timeSec: i / sampleRate,
        });
    }

    return vectors;
}
