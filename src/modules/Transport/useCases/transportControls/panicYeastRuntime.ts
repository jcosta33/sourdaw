import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { yeastPanic } from '#/modules/Yeast/useCases';

/**
 * Transport owns teardown ordering; Yeast owns the runtime reset itself. Post
 * the panic before scheduler restart so Worker state and the host-owned output
 * note ledger settle before a later block can be processed.
 */
export function panicYeastRuntime(): Promise<void> {
    const context = getAudioContext();
    const nowSamples = Math.round(context.currentTime * context.sampleRate);
    return yeastPanic(nowSamples);
}
