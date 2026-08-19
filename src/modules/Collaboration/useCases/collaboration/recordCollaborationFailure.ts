import { collaborationStore } from '../../stores/collaborationStore';

/**
 * Surface a host-side operation failure in the collaboration store so the
 * panel's error row renders it. Unlike a failed join, a failed invite or
 * answer-acceptance leaves the session itself intact — existing peers stay
 * connected — so only `error` is written; `connectionStatus` keeps reporting
 * the real link state.
 */
export function recordCollaborationFailure(error: unknown): void {
    const state = collaborationStore.value;
    if (!state) {
        return;
    }
    collaborationStore.set({
        ...state,
        error: error instanceof Error ? error.message : String(error),
    });
}
