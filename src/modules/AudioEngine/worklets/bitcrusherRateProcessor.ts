/**
 * Sample-and-hold decimator behind the built-in bitcrusher's "Rate Reduction"
 * control.
 *
 * The rest of the bitcrusher is a `WaveShaperNode`: bit-depth reduction is a
 * memoryless map from input sample to output sample, so a curve expresses it
 * exactly. Rate reduction is not — holding a sample for N frames needs state
 * that survives across render quanta — so it cannot live in the curve and rides
 * here instead.
 *
 * `rate` is a **divisor**, matching the descriptor's `1..40` range, its `x`
 * unit and its neutral default of 1: the input is resampled to
 * `sampleRate / rate` and held. 1 is a bit-exact pass-through; 40 at 48 kHz is
 * a 1.2 kHz effective rate.
 *
 * **No anti-alias filter, deliberately.** Decimating without band-limiting
 * folds images back into the audible band, and in a bitcrusher those images are
 * the effect — filtering them out would leave a quiet low-pass. Sample-and-hold
 * only ever re-emits samples that arrived, so the output is bounded by the
 * input peak and cannot ring or diverge however violent the harmonics look.
 *
 * RT contract: no allocation, no locks, no branching on anything unbounded. The
 * held-sample scratch is sized once at construction.
 */

/** Generous upper bound on channels; the bitcrusher runs stereo. */
const MAX_CHANNELS = 32;

/** Mirrors the `crush-rate` descriptor bounds in BuiltinEffectDescriptors. */
const MIN_RATE = 1;
const MAX_RATE = 40;

/**
 * The processor-side shape of an AudioParam declaration. Declared locally
 * because TypeScript's DOM lib models only the consumer side of the worklet
 * boundary (see `src/types/audio-worklet.d.ts`), same as grinderProcessor does.
 */
type RateParamDescriptor = {
    readonly name: string;
    readonly defaultValue: number;
    readonly minValue: number;
    readonly maxValue: number;
    readonly automationRate: 'a-rate' | 'k-rate';
};

export class BitcrusherRateProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors(): readonly RateParamDescriptor[] {
        return [
            {
                name: 'rate',
                defaultValue: MIN_RATE,
                minValue: MIN_RATE,
                maxValue: MAX_RATE,
                automationRate: 'k-rate',
            },
        ];
    }

    /** The sample currently being held, per channel. */
    private readonly _held = new Float32Array(MAX_CHANNELS);

    /**
     * Frames left before the next grab, carried across blocks so the staircase
     * does not restart every 128 frames.
     *
     * Fractional because `rate` is a float: accumulating the remainder keeps the
     * average hold length exact for non-integer rates instead of quantising
     * automation to whole divisors.
     */
    private _framesUntilGrab = 0;

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length === 0 || !output || output.length === 0) {
            return true;
        }

        const rawRate = parameters.rate?.[0] ?? MIN_RATE;
        const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, rawRate));
        const channelCount = Math.min(input.length, output.length, MAX_CHANNELS);

        // At the neutral rate every frame is grabbed and re-emitted unchanged,
        // so skip the per-sample walk. The knob sits at 1 by default and this
        // node is in the chain of every bitcrusher instance.
        if (rate === MIN_RATE) {
            for (let channel = 0; channel < channelCount; channel++) {
                const inData = input[channel];
                const outData = output[channel];
                if (inData && outData) {
                    outData.set(inData);
                    this._held[channel] = inData[inData.length - 1] ?? 0;
                }
            }
            this._framesUntilGrab = 0;
            return true;
        }

        const frameCount = input[0]?.length ?? 0;
        for (let frame = 0; frame < frameCount; frame++) {
            // One counter for every channel: grabbing them together is what
            // keeps a stereo image intact instead of smearing the sides.
            if (this._framesUntilGrab <= 0) {
                for (let channel = 0; channel < channelCount; channel++) {
                    this._held[channel] = input[channel]?.[frame] ?? 0;
                }
                this._framesUntilGrab += rate;
            }
            this._framesUntilGrab -= 1;

            for (let channel = 0; channel < channelCount; channel++) {
                const outData = output[channel];
                if (outData) {
                    outData[frame] = this._held[channel]!;
                }
            }
        }

        return true;
    }
}

registerProcessor('bitcrusher-rate-processor', BitcrusherRateProcessor);
