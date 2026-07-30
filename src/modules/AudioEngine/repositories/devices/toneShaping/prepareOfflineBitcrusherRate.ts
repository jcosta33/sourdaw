import bitcrusherRateProcessorUrl from '../../../services/bitcrusherRateProcessor.ts?worker&url';

/**
 * Register the bitcrusher's sample-and-hold processor on an offline context.
 *
 * The live engine loads this module once in `initialize()`, but every render
 * and every stem gets a fresh `OfflineAudioContext` with an empty worklet
 * registry, and `createBitcrusher` builds its node synchronously. Without this
 * call first, `createBitcrusherRateDecimator` degrades to the shaper-only graph
 * and the bounce comes out without the rate reduction the engineer heard —
 * export silently disagreeing with playback.
 */
export async function prepareOfflineBitcrusherRate(offlineCtx: OfflineAudioContext): Promise<void> {
    await offlineCtx.audioWorklet.addModule(bitcrusherRateProcessorUrl);
}
