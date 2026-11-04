/**
 * Loads a worklet processor into the worklet scope a spec has installed
 * (`installWorkletGlobals`), by the name the processor registers under.
 *
 * Production reaches a processor only through `audioWorklet.addModule`, so a
 * spec outside `worklets/` names the processor and never imports its file.
 */
const PROCESSOR_MODULE_LOADERS = {
    'bitcrusher-rate-processor': () => import('../worklets/bitcrusherRateProcessor'),
    'levain-processor': () => import('../worklets/levainProcessor'),
    'metering-processor': () => import('../worklets/meteringProcessor'),
    'recording-processor': () => import('../worklets/recordingProcessor'),
} as const;

export type WorkletProcessorName = keyof typeof PROCESSOR_MODULE_LOADERS;

export async function importWorkletProcessor(name: WorkletProcessorName): Promise<void> {
    await PROCESSOR_MODULE_LOADERS[name]();
}
