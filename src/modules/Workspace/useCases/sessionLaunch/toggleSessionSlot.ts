import { sessionLaunchStore, type SessionLaunchState } from '../../stores/sessionLaunchStore';

const emptyState: SessionLaunchState = { activeSlots: {} };

/**
 * Toggle the launched clip slot for a track: launching `sceneIndex` when it is
 * not already the active slot, or clearing it when it is. Write boundary for the
 * session-launch store so the SessionView no longer mutates the store inline.
 */
export function toggleSessionSlot(trackId: string, sceneIndex: number): void {
    const current = sessionLaunchStore.value ?? emptyState;
    const next = { ...current.activeSlots };
    if (next[trackId] === sceneIndex) {
        delete next[trackId];
    } else {
        next[trackId] = sceneIndex;
    }
    sessionLaunchStore.set({ activeSlots: next });
}
