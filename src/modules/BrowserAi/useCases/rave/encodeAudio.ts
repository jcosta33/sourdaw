import { type LatentVector } from '../../stores/rave';

/**
 * PLACEHOLDER — NOT A NEURAL ENCODER. Awaiting a real RAVE model.
 *
 * This is a hand-written `Math.sin`/`Math.tanh` transform over the samples. It
 * is not the RAVE encoder, it does not approximate one, and its output is not
 * a latent representation of anything. It exists only to hold the call shape a
 * real ONNX encoder will take.
 *
 * It has no production caller and must not acquire one while it is still this
 * function: nothing derived from it may reach a user's project, because a
 * fabricated result presenting as a neural codec is worse than no result.
 * Replace the body with the ONNX call before wiring anything to it.
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
