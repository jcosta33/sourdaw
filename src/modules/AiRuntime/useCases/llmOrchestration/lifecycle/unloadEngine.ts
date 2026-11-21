import { unloadWebLlmEngine } from '../../../repositories/webLlm/unloadWebLlmEngine';
import { answeringStatus } from '../../../stores/answeringStatus';

/** Unload the browser model and return the runtime to idle. */
export function unloadEngine(): void {
    unloadWebLlmEngine();
    answeringStatus.publishEngineStatus({ state: 'idle' });
}
