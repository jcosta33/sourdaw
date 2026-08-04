import { type LatentVector } from '../../stores/rave';

/**
 * PLACEHOLDER — NOT A NEURAL DECODER. Awaiting a real RAVE model.
 *
 * This sums `Math.sin` partials at harmonics of 100 Hz weighted by the input
 * numbers. Feed it the output of `encodeAudio` and you get an additive tone,
 * not a reconstruction — the pair is a sine transform wearing a codec's name.
 *
 * It has no production caller and must not acquire one while it is still this
 * function; see the notice on `encodeAudio`. Replace the body with the ONNX
 * call before wiring anything to it.
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
