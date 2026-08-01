/**
 * Peak below which a rendered buffer counts as digital silence.
 *
 * -100 dBFS. Deliberately an order of magnitude under the -80 dBFS floor the
 * bounce path's own `trimSilence` treats as "still audio", so nothing this
 * codebase already calls signal can fall under it. The threshold exists rather
 * than an exact `=== 0` test because a chain that ends in a filter or a fader
 * ramp can leave denormal-scale dust behind while producing nothing audible.
 */
const SILENT_RENDER_PEAK = 1e-5;

/**
 * The part of an `AudioBuffer` a silence scan reads. Narrower than `AudioBuffer`
 * on purpose: nothing here needs the sample rate, the length or the copy
 * methods, and a narrow input keeps the check callable on any rendered result.
 */
export type SilenceScannableBuffer = {
    numberOfChannels: number;
    getChannelData: (channel: number) => Float32Array;
};

/**
 * True when every sample in every channel sits at or below the silence floor.
 *
 * A non-finite sample (NaN, ±Infinity) reports **not silent**. Such a buffer is
 * broken rather than quiet, and the silence guard is not the right refusal to
 * raise over it — mislabelling it would hide the real defect behind this one.
 */
export function isSilentAudioBuffer(buffer: SilenceScannableBuffer): boolean {
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const samples = buffer.getChannelData(channel);
        for (const sample of samples) {
            const magnitude = Math.abs(sample);
            if (Number.isNaN(magnitude) || magnitude > SILENT_RENDER_PEAK) {
                return false;
            }
        }
    }
    return true;
}
