import { engineState } from './engineLifecycleState';

export function getActiveModelId(): string {
    return engineState.activeModelId;
}
