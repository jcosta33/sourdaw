import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { yeastPanic } from '#/modules/Yeast/useCases';

/**
 * Transport owns teardown ordering; Yeast owns the runtime reset itself. Post
 * the panic before scheduler restart so the worklet's ordered message queue
 * clears generated state before a later block can be processed.
 */
export function panicYeastRuntime(): void {
    const context = getAudioContext();
    const nowSamples = Math.round(context.currentTime * context.sampleRate);
    void yeastPanic(nowSamples);
}
