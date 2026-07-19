import { automationStore } from '../stores/automationStore';

import { automationDrawModeState } from './automationDrawMode';
import { flushPendingDrawState } from './flushPendingDrawState';

export type CommitAutomationDrawUndo = (label: string, undo: () => void, redo: () => unknown) => void;

export function commitEndDrawSession(commitUndo: CommitAutomationDrawUndo): void {
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

    commitUndo(
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
