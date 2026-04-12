import { type LatentVector } from '../../stores/rave';

/**
 * Decode latent vectors back to audio samples.
 * In production this calls the ONNX decoder model.
 */
export function decodeLatent(vectors: LatentVector[], sampleRate: number): Float32Array {
    const frameSize = Math.floor(sampleRate * 0.02);
    const totalSamples = vectors.length * frameSize;
    const output = new Float32Array(totalSamples);

    for (let vi = 0; vi < vectors.length; vi++) {
        const v = vectors[vi]!;
        const offset = vi * frameSize;

        for (let j = 0; j < frameSize; j++) {
            let sample = 0;
            for (let d = 0; d < v.values.length; d++) {
                sample += v.values[d]! * Math.sin((2 * Math.PI * (d + 1) * 100 * j) / sampleRate) * 0.1;
            }
            if (offset + j < output.length) {
                output[offset + j] = Math.tanh(sample);
            }
        }
    }

    return output;
}
