import { collaborationStore } from '../../stores/collaborationStore';

export function canExecuteCommandBatch(): boolean {
    const state = collaborationStore.value;
    return state === null || !state.isEnabled || state.isHost;
}
