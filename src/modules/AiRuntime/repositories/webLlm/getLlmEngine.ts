import { engineState, type WebLlmEngine } from './engineLifecycleState';

export function getLlmEngine(): WebLlmEngine | null {
    return engineState.engine;
}
