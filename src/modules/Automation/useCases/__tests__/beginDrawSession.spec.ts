import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { automationStore, type AutomationStoreState } from '../../stores/automationStore';
import { automationDrawModeState } from '../automationDrawMode';
import { beginDrawSession } from '../beginDrawSession';

function makeStoreState(): AutomationStoreState {
    return {
        lanes: [
            {
                id: 'lane-1',
                trackId: 'track-1',
                parameterId: 'gain',
                parameterName: 'Gain',
                points: [
                    { beat: 0, value: 0.5, curve: 'step', tension: 0 },
                    { beat: 2, value: 0.8, curve: 'step', tension: 0 },
                ],
                minValue: 0,
                maxValue: 1,
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
            },
        ],
    };
}

describe('beginDrawSession', () => {
    beforeEach(() => {
        automationDrawModeState.activeSession = null;
        automationStore.set(makeStoreState());
    });

    afterEach(() => {
        automationDrawModeState.activeSession = null;
    });

    it('creates an active session with the given lane, grid, and constrain flag', () => {
        beginDrawSession('lane-1', 0.5, true);

        const session = automationDrawModeState.activeSession;
        expect(session).not.toBeNull();
        expect(session?.laneId).toBe('lane-1');
        expect(session?.gridResolution).toBe(0.5);
        expect(session?.constrainHorizontal).toBe(true);
        expect(session?.initialValue).toBeNull();
        expect(session?.drawnBeats).toEqual(new Set());
        expect(session?.pendingState).toBeNull();
        expect(session?.rafId).toBeNull();
    });

    it('snapshots the lane existing points into previousPoints', () => {
        beginDrawSession('lane-1', 0.25, false);

        const session = automationDrawModeState.activeSession;
        expect(session?.previousPoints).toHaveLength(2);
        expect(session?.previousPoints[0]?.beat).toBe(0);
        expect(session?.previousPoints[1]?.beat).toBe(2);
    });

    it('previousPoints is a copy, not the same array reference as the lane', () => {
        const lane = automationStore.value!.lanes.find((l) => l.id === 'lane-1')!;

        beginDrawSession('lane-1', 0.25, false);

        const session = automationDrawModeState.activeSession;
        expect(session?.previousPoints).not.toBe(lane.points);
    });

    it('is a no-op when the store is null', () => {
        automationStore.set(null);

        beginDrawSession('lane-1', 0.25, false);

        expect(automationDrawModeState.activeSession).toBeNull();
    });

    it('is a no-op when the lane does not exist', () => {
        beginDrawSession('nonexistent', 0.25, false);

        expect(automationDrawModeState.activeSession).toBeNull();
    });
});
