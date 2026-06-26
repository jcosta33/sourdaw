import { sessionLaunchStore } from '../../stores/sessionLaunchStore';

/**
 * Launch a scene across the given tracks: every track's active slot is set to
 * `sceneIndex`. Write boundary for the session-launch store.
 */
export function launchSessionScene(trackIds: string[], sceneIndex: number): void {
    const next: Record<string, number> = {};
    for (const trackId of trackIds) {
        next[trackId] = sceneIndex;
    }
    sessionLaunchStore.set({ activeSlots: next });
}
