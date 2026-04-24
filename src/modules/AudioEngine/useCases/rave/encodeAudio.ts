import { type LatentVector } from '../../stores/rave';

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

    for (let index = 0; index < samples.length - frameSize; index += frameSize) {
        const values: number[] = [];
        for (let data = 0; data < latentDim; data++) {
            let sum = 0;
            const stride = Math.floor(frameSize / latentDim);
            for (let jIndex = 0; jIndex < stride; jIndex++) {
                const idx = index + data * stride + jIndex;
                if (idx < samples.length) {
                    sum += samples[idx]! * Math.sin((data + 1) * jIndex * 0.1);
                }
            }
            values.push(Math.tanh(sum * 10));
        }

        vectors.push({
            values,
            timeSec: index / sampleRate,
        });
    }

    return vectors;
}
