import { automationStore } from '../stores/automationStore';

import { automationDrawModeState } from './automationDrawMode';

/**
 * Begin a draw-mode painting session.
 */
export function beginDrawSession(laneId: string, gridResolution: number, constrainHorizontal: boolean): void {
    const state = automationStore.value;
    if (!state) {
        return;
    }

    const lane = state.lanes.find((candidateLane) => candidateLane.id === laneId);
    if (!lane) {
        return;
    }

    automationDrawModeState.activeSession = {
        laneId,
        gridResolution,
        constrainHorizontal,
        initialValue: null,
        drawnBeats: new Set(),
        previousPoints: [...lane.points],
        pendingState: null,
        rafId: null,
    };
}
