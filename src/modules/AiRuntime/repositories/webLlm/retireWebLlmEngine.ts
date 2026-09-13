import { engineState, type WebLlmEngine } from './engineLifecycleState';
import { webLlmRequestCoordinator } from './webLlmRequestCoordinator';

export function retireWebLlmEngine(engine: WebLlmEngine, reason: unknown): void {
    webLlmRequestCoordinator.retire(engine, reason);
    if (engineState.engine !== engine) {
        return;
    }
    const worker = engineState.worker;
    engineState.engine = null;
    engineState.worker = null;
    engineState.activeArtifactSetDigest = null;
    worker?.terminate();
}
