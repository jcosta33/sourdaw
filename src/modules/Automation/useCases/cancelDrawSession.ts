import { automationStore } from '../stores/automationStore';

import { automationDrawModeState } from './automationDrawMode';

/**
 * Cancel an active draw session without committing it — the Escape-mid-draw
 * counterpart to `endDrawSession`. Unschedules the pending rAF flush (so a
 * `flushPendingDrawState` queued by the last `paintDrawPoint` cannot write to
 * the store after cancellation), restores the lane to the point set it had
 * before the session started, and clears the session. No undo entry: nothing
 * was ever committed for the user to undo.
 */
export function cancelDrawSession(): void {
    const activeSession = automationDrawModeState.activeSession;
    if (activeSession === null) {
        return;
    }

    if (activeSession.rafId !== null) {
        cancelAnimationFrame(activeSession.rafId);
        activeSession.rafId = null;
    }
    activeSession.pendingState = null;

    const { laneId, previousPoints } = activeSession;
    const state = automationStore.value;
    if (state) {
        automationStore.set({
            lanes: state.lanes.map((lane) => (lane.id === laneId ? { ...lane, points: previousPoints } : lane)),
        });
    }

    automationDrawModeState.activeSession = null;
}
