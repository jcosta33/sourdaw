/**
 * Sharpens frame-quantised onset times to the sample the attack actually peaks
 * on.
 *
 * A spectral-flux detector can only place an onset on the analysis frame whose
 * energy rose, so its timestamps sit up to one window early — a click at 0.500 s
 * is reported at 0.469 s. A receipt that an agent cites against a bar line
 * cannot carry that bias, so each reported time is re-read from the samples: the
 * loudest sample in the short interval that follows the detected frame.
 */

/** Long enough to contain the attack the detector fired on, short enough not to reach the next one. */
const REFINEMENT_SECONDS = 0.05;

export type RefineOnsetTimesInput = {
    readonly channel: Float32Array;
    readonly length: number;
    readonly sampleRate: number;
    readonly onsetTimesSec: readonly number[];
};

export function refineOnsetTimes({ channel, length, sampleRate, onsetTimesSec }: RefineOnsetTimesInput): number[] {
    if (length <= 0 || sampleRate <= 0) {
        return [];
    }
    const refinementFrames = Math.max(1, Math.round(REFINEMENT_SECONDS * sampleRate));

    return onsetTimesSec.map((timeSec) => {
        const start = Math.min(length - 1, Math.max(0, Math.round(timeSec * sampleRate)));
        const end = Math.min(length, start + refinementFrames);
        let peakIndex = start;
        let peak = -1;
        for (let index = start; index < end; index++) {
            const magnitude = Math.abs(channel[index] ?? 0);
            if (magnitude > peak) {
                peak = magnitude;
                peakIndex = index;
            }
        }
        return peakIndex / sampleRate;
    });
}
