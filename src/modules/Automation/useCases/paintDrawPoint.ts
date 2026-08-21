import { type AutomationPoint } from '../models/Automation';
import { automationStore, type AutomationStoreState } from '../stores/automationStore';

import { getAutomationLaneCeiling } from './automation/getAutomationLaneCeiling';
import { automationDrawModeState } from './automationDrawMode';
import { flushPendingDrawState } from './flushPendingDrawState';
import { snapDrawBeatToGrid } from './snapDrawBeatToGrid';

/**
 * Paint a point during an active draw session.
 * Replaces any existing point at the snapped beat.
 */
export function paintDrawPoint(beat: number, value: number): void {
    const activeSession = automationDrawModeState.activeSession;
    if (activeSession === null) {
        return;
    }

    const snappedBeat = snapDrawBeatToGrid(beat, activeSession.gridResolution);

    if (activeSession.initialValue === null) {
        activeSession.initialValue = value;
    }

    const paintValue = activeSession.constrainHorizontal ? activeSession.initialValue : value;
    const state = activeSession.pendingState ?? automationStore.value;
    if (!state) {
        return;
    }

    const nextState: AutomationStoreState = {
        lanes: state.lanes.map((lane) => {
            if (lane.id !== activeSession.laneId) {
                return lane;
            }

            const filteredPoints = lane.points.filter((point) => Math.abs(point.beat - snappedBeat) > 0.001);
            const newPoint: AutomationPoint = {
                beat: snappedBeat,
                value: Math.max(lane.minValue, Math.min(getAutomationLaneCeiling(lane), paintValue)),
                curve: 'step',
                tension: 0,
            };

            return {
                ...lane,
                points: [...filteredPoints, newPoint].sort(
                    (firstPoint, secondPoint) => firstPoint.beat - secondPoint.beat
                ),
            };
        }),
    };

    activeSession.pendingState = nextState;
    activeSession.drawnBeats.add(snappedBeat);

    if (activeSession.rafId === null) {
        activeSession.rafId = requestAnimationFrame(flushPendingDrawState);
    }
}
