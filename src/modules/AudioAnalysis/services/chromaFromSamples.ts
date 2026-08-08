/**
 * Chroma (pitch-class energy) extraction via the Goertzel algorithm.
 *
 * One Goertzel evaluation per equal-tempered semitone across octaves 2-7,
 * summed into 12 pitch-class bins and normalised so the loudest bin is 1.
 * Pure so the key classifier and its guards can be driven from synthesised
 * signals without an AudioContext.
 */

const PITCH_CLASSES = 12;
const LOWEST_OCTAVE = 2;
const HIGHEST_OCTAVE = 7;
const A4_HZ = 440;

export type ChromaFromSamplesInput = {
    samples: Float32Array;
    sampleRate: number;
    frameSize?: number;
    hopSize?: number;
};

/**
 * Returns a 12-element chroma vector normalised to a maximum of 1, or `null`
 * when the signal carries no energy in the analysed band (silence).
 */
export function chromaFromSamples({
    samples,
    sampleRate,
    frameSize = 4096,
    hopSize = 2048,
}: ChromaFromSamplesInput): number[] | null {
    const chroma = Array.from({ length: PITCH_CLASSES }, () => 0);

    for (let frame = 0; frame + frameSize < samples.length; frame += hopSize) {
        for (let note = 0; note < PITCH_CLASSES; note++) {
            for (let octave = LOWEST_OCTAVE; octave <= HIGHEST_OCTAVE; octave++) {
                const frequency = A4_HZ * 2 ** ((note - 9 + (octave - 4) * PITCH_CLASSES) / PITCH_CLASSES);
                const binIndex = Math.round((frequency * frameSize) / sampleRate);
                if (binIndex <= 0 || binIndex >= frameSize / 2) {
                    continue;
                }

                const omega = (2 * Math.PI * binIndex) / frameSize;
                const coefficient = 2 * Math.cos(omega);
                let previous = 0;
                let beforePrevious = 0;

                for (let index = 0; index < frameSize; index++) {
                    const current = (samples[frame + index] ?? 0) + coefficient * previous - beforePrevious;
                    beforePrevious = previous;
                    previous = current;
                }

                const power =
                    previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
                chroma[note] = (chroma[note] ?? 0) + Math.abs(power);
            }
        }
    }

    const peak = Math.max(...chroma);
    if (peak === 0) {
        return null;
    }

    return chroma.map((value) => value / peak);
}
