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
        const value = vectors[vi]!;
        const offset = vi * frameSize;

        for (let jIndex = 0; jIndex < frameSize; jIndex++) {
            let sample = 0;
            for (let data = 0; data < value.values.length; data++) {
                sample += value.values[data]! * Math.sin((2 * Math.PI * (data + 1) * 100 * jIndex) / sampleRate) * 0.1;
            }
            if (offset + jIndex < output.length) {
                output[offset + jIndex] = Math.tanh(sample);
            }
        }
    }

    return output;
}
