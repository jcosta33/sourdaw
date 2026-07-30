/**
 * The bitcrusher's sample-and-hold stage, or `null` where it cannot be built.
 *
 * Returns `null` rather than throwing on purpose. `createBitcrusher` is
 * synchronous — the live engine and both offline render paths call it while
 * building a strip — but an AudioWorklet module is registered asynchronously, so
 * a context that has not loaded `bitcrusher-rate-processor` (a render started
 * before the module resolved, a browser without worklet support, a test double)
 * would otherwise fail the whole device. Degrading to the shaper-only graph
 * costs rate reduction and keeps bit depth, dry/wet and the signal path intact,
 * which is the right trade for a lo-fi colour effect.
 */
export function createBitcrusherRateDecimator(ctx: BaseAudioContext): AudioWorkletNode | null {
    if (typeof AudioWorkletNode === 'undefined') {
        return null;
    }

    try {
        // `outputChannelCount` is deliberately left unset: with one input and one
        // output the node then takes its output channel count from its computed
        // input, so mono stays mono. Pinning it to [2] would hand a mono source a
        // silent right channel, which the WaveShaper it sits behind never does.
        return new AudioWorkletNode(ctx, 'bitcrusher-rate-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
        });
    } catch {
        return null;
    }
}
