import { collaborationStore } from '../../stores/collaborationStore';

/** Clear a previously surfaced failure when a new attempt starts. */
export function clearCollaborationFailure(): void {
    const state = collaborationStore.value;
    if (!state || state.error === null) {
        return;
    }
    collaborationStore.set({
        ...state,
        error: null,
    });
}
