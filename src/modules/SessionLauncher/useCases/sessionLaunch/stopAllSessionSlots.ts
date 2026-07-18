import { sessionLaunchStore } from '../../stores/sessionLaunchStore';

/**
 * Stop all launched clips: clears every active session slot. Write boundary for
 * the session-launch store.
 */
export function stopAllSessionSlots(): void {
    sessionLaunchStore.set({ activeSlots: {} });
}
