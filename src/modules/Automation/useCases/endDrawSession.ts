import { pushUndoEntry } from '#/modules/Command/useCases';

import { automationStore } from '../stores/automationStore';

import { automationDrawModeState } from './automationDrawMode';
import { flushPendingDrawState } from './flushPendingDrawState';

/**
 * End the draw session and register an undo entry.
 */
export function endDrawSession(): void {
    const activeSession = automationDrawModeState.activeSession;
    if (activeSession === null) {
        return;
    }

    if (activeSession.rafId !== null) {
        cancelAnimationFrame(activeSession.rafId);
        activeSession.rafId = null;
    }
    flushPendingDrawState();

    const { laneId, previousPoints } = activeSession;
    const state = automationStore.value;
    const currentLane = state?.lanes.find((lane) => lane.id === laneId);
    const currentPoints = currentLane ? [...currentLane.points] : [];

    pushUndoEntry(
        'Draw automation',
        () => {
            const undoState = automationStore.value;
            if (!undoState) {
                return;
            }

            automationStore.set({
                lanes: undoState.lanes.map((lane) => (lane.id === laneId ? { ...lane, points: previousPoints } : lane)),
            });
        },
        () => {
            const redoState = automationStore.value;
            if (!redoState) {
                return;
            }

            automationStore.set({
                lanes: redoState.lanes.map((lane) => (lane.id === laneId ? { ...lane, points: currentPoints } : lane)),
            });
        }
    );

    automationDrawModeState.activeSession = null;
}
