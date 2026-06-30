import { engineState } from './engineLifecycleState';

export function isWebLlmLoaded(): boolean {
    return engineState.engine !== null;
}
