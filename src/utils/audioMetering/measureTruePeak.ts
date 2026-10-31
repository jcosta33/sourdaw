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

/** Existing reconstruction kernel with bounded per-channel carry and one final zero drain. */
export function createTruePeakAccumulator(numberOfChannels: number) {
    const histories = Array.from({ length: numberOfChannels }, () => new Float64Array(TAPS));
    let peak = 0,
        frames = 0,
        finished = false;
    const accept = (history: Float64Array, sample: number) => {
        history.copyWithin(0, 1);
        history[TAPS - 1] = Number.isFinite(sample) ? sample : 0;
        for (let phase = 0; phase < PHASES; phase++) {
            const coefficients = PHASE_COEFFS[phase]!;
            let sum = 0;
            for (let tap = 0; tap < TAPS; tap++) {
                sum += history[tap]! * coefficients[tap]!;
            }
            peak = Math.max(peak, Math.abs(sum));
        }
    };
    return {
        push(channels: readonly Float32Array[]) {
            if (finished) {
                throw new Error('True peak meter is finished.');
            }
            const length = channels[0]?.length ?? 0;
            if (channels.length !== numberOfChannels || channels.some((channel) => channel.length !== length)) {
                throw new Error('Invalid true peak PCM block.');
            }
            for (const [index, channel] of channels.entries()) {
                for (const sample of channel) {
                    accept(histories[index]!, sample);
                }
            }
            frames += length;
        },
        finish() {
            if (!finished && frames > 0) {
                for (const history of histories) {
                    for (let tail = 0; tail < TAPS - 1; tail++) {
                        accept(history, 0);
                    }
                }
            }
            finished = true;
            return peak;
        },
    };
}

/** Highest reconstructed absolute sample, including the last sample's complete filter tail. */
export function measureTruePeak({ channels, length }: { channels: readonly Float32Array[]; length: number }): number {
    const meter = createTruePeakAccumulator(channels.length);
    for (let start = 0; start < length; start += 4096) {
        const count = Math.min(4096, length - start);
        meter.push(
            channels.map((channel) => {
                if (channel.length >= start + count) {
                    return channel.subarray(start, start + count);
                }
                const padded = new Float32Array(count);
                padded.set(channel.subarray(start, start + count));
                return padded;
            })
        );
    }
    return meter.finish();
}
