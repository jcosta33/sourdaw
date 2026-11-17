import type { AudioEngineDiagnostics } from '../../models/AudioEngineState';

export function createEmptyGraphSlotResourcesByLoadState(): AudioEngineDiagnostics['graph']['graphSlotResourcesByLoadState'] {
    return {
        ready: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
        pending: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
        failed: { audioNodes: 0, audioWorkletProcessors: 0, workers: 0 },
    };
}
