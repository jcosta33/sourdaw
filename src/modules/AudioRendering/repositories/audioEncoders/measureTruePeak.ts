/**
 * True-peak (inter-sample peak) measurement — ITU-R BS.1770-4, Annex 2.
 *
 * A signal whose samples all sit below a ceiling can still reconstruct above it
 * between samples, which is why a mix that passes a sample-peak check can still
 * clip once an MP3 or FLAC decoder reconstructs it. BS.1770 defines true peak
 * as the maximum of the waveform reconstructed at at least 4x the base rate.
 *
 * The coefficient table below is the same one the native Proof metering path
 * uses (`crates/daw-dsp/src/proof/true_peak.rs`), so the export measures peaks
 * against the same reconstruction the meters show.
 */

const TAPS = 12;
const PHASES = 4;

/**
 * Polyphase branches of the BS.1770-4 4x over-sampling filter; branch `p`
 * reconstructs the waveform at base-rate offset `p / 4`.
 *
 * Transcribed at the recommendation's own precision (BS.1770-4 Annex 2,
 * Table 3) so the table can be diffed against the published one.
 */
// One coefficient per line so the table stays diffable against BS.1770-4
// Table 3 and against crates/daw-dsp/src/proof/true_peak.rs, rather than being
// reflowed into dense rows whose alignment to the published table is unclear.
// prettier-ignore
const PHASE_COEFFS: readonly (readonly number[])[] = [
    [
        0.001708984375,
        0.010986328125,
        -0.0196533203125,
        0.033203125,
        -0.0594482421875,
        0.1373291015625,
        0.97216796875,
        -0.102294921875,
        0.047607421875,
        -0.026611328125,
        0.014892578125,
        -0.00830078125,
    ],
    [
        -0.0291748046875,
        0.029296875,
        -0.0517578125,
        0.089111328125,
        -0.16650390625,
        0.465087890625,
        0.77978515625,
        -0.2003173828125,
        0.1015625,
        -0.0582275390625,
        0.0330810546875,
        -0.0189208984375,
    ],
    [
        -0.0189208984375,
        0.0330810546875,
        -0.0582275390625,
        0.1015625,
        -0.2003173828125,
        0.77978515625,
        0.465087890625,
        -0.16650390625,
        0.089111328125,
        -0.0517578125,
        0.029296875,
        -0.0291748046875,
    ],
    [
        -0.00830078125,
        0.014892578125,
        -0.026611328125,
        0.047607421875,
        -0.102294921875,
        0.97216796875,
        0.1373291015625,
        -0.0594482421875,
        0.033203125,
        -0.0196533203125,
        0.010986328125,
        0.001708984375,
    ],
];

/**
 * Highest reconstructed absolute sample across all channels, in linear scale
 * (1 = 0 dBFS). Returns 0 for empty input.
 */
export function measureTruePeak({ channels, length }: { channels: readonly Float32Array[]; length: number }): number {
    let peak = 0;

    for (const channel of channels) {
        // Sliding window of the last TAPS input samples, zero-padded at the start.
        const history = new Float64Array(TAPS);
        const framesToMeasure = length > 0 ? length + TAPS - 1 : 0;

        for (let index = 0; index < framesToMeasure; index++) {
            history.copyWithin(0, 1);
            const sample = index < length ? (channel[index] ?? 0) : 0;
            history[TAPS - 1] = Number.isFinite(sample) ? sample : 0;

            for (let phase = 0; phase < PHASES; phase++) {
                const coefficients = PHASE_COEFFS[phase]!;
                let sum = 0;
                for (let tap = 0; tap < TAPS; tap++) {
                    sum += history[tap]! * coefficients[tap]!;
                }
                const magnitude = Math.abs(sum);
                if (magnitude > peak) {
                    peak = magnitude;
                }
            }
        }
    }

    return peak;
}
