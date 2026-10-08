import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutomationLane, type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { is_exact_automation_lane, type AutomationStoreState } from '../../../stores/automationStore';

const mocks = vi.hoisted(() => {
    const state: { value: AutomationStoreState | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): AutomationStoreState | null => state.value),
        set: vi.fn((nextState: AutomationStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/automationStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/automationStore')>()),
    automationStore: {
        get value(): AutomationStoreState | null {
            return mocks.getValue();
        },
        set: mocks.set,
    },
}));

const { cloneClipAutomationLanes } = await import('../cloneClipAutomationLanes');

describe('cloneClipAutomationLanes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clones the captured lanes onto the target clip id and appends them to the store', () => {
        const capturedPoint: AutomationPoint = {
            beat: 0,
            value: 0.5,
            curve: 'bezier',
            tension: 0,
            cp1: { x: 0.2, y: 0.3 },
        };
        const capturedLane: AutomationLane = {
            ...createAutomationLane('t1', 'gain', 'Gain', 0, 1, 'clip-a'),
            id: 'captured-lane',
            visible: false,
            points: [capturedPoint],
        };
        const unrelatedLane = { ...createAutomationLane('t1', 'pan', 'Pan'), id: 'other', clipId: 'clip-b' };
        mocks.state.value = { lanes: [unrelatedLane] };

        cloneClipAutomationLanes([capturedLane], 'pasted-clip');

        const lanes = mocks.state.value.lanes;
        expect(lanes).toHaveLength(2);
        const clone = lanes[1]!;
        expect(clone.clipId).toBe('pasted-clip');
        expect(clone.id).not.toBe('captured-lane');
        expect(clone.trackId).toBe('t1');
        expect(clone.parameterId).toBe('gain');
        expect(clone.visible).toBe(false);
        expect(clone.points).toEqual([capturedPoint]);

        // The clone must not alias the captured snapshot: two pastes from one
        // entry clone from the same capture, so a shared point would leak the
        // first paste's edits into the second.
        clone.points[0]!.cp1!.x = 0.99;
        expect(capturedPoint.cp1!.x).toBe(0.2);
    });

    it('carries every persisted lane field onto the clone and re-pins object lane ids', () => {
        const capturedLane: AutomationLane = {
            ...createAutomationLane('t1', 'gain', 'Gain'),
            id: 'captured-lane',
            clipId: 'clip-a',
            clipAutomationMode: 'multiplicative',
            enabled: false,
            collapsed: true,
            linkedLaneId: 'lane-leader',
            linkScale: -1,
            viewMinValue: -0.5,
            viewMaxValue: 1.5,
            color: '#ff8800',
            points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
            trimPoints: [{ beat: 1, value: 0.2, curve: 'bezier', tension: 0, cp1: { x: 0.1, y: 0.2 } }],
            ghostPoints: [{ beat: 2, value: 0.3, curve: 'stairs', tension: 0, stairSteps: 4 }],
            objects: [
                {
                    id: 'obj-1',
                    laneId: 'captured-lane',
                    startBeat: 0,
                    endBeat: 4,
                    points: [{ beat: 0, value: 0.5, curve: 'bezier', tension: 0, cp2: { x: 0.7, y: 0.8 } }],
                    name: 'Container',
                },
            ],
        };
        mocks.state.value = { lanes: [] };

        cloneClipAutomationLanes([capturedLane], 'pasted-clip');

        const clone = mocks.state.value.lanes[0]!;
        // The clone must survive the store's exact-shape check unchanged: a
        // missing field or a minted `cp1: undefined` key would force a
        // normalize repair on the next hydrate instead of the identity path.
        expect(is_exact_automation_lane(clone)).toBe(true);
        expect(clone.clipAutomationMode).toBe('multiplicative');
        // Every assertion uses a non-default source value, so a field the
        // clone stops carrying fails its assertion instead of passing on the
        // factory default or on absence.
        expect(clone.enabled).toBe(false);
        expect(clone.collapsed).toBe(true);
        expect(clone.linkedLaneId).toBe('lane-leader');
        expect(clone.linkScale).toBe(-1);
        expect(clone.viewMinValue).toBe(-0.5);
        expect(clone.viewMaxValue).toBe(1.5);
        expect(clone.color).toBe('#ff8800');
        expect(clone.trimPoints).toEqual(capturedLane.trimPoints);
        expect(clone.ghostPoints).toEqual(capturedLane.ghostPoints);
        expect(clone.objects).toHaveLength(1);
        expect(clone.objects[0]!.laneId).toBe(clone.id);
        expect(clone.objects[0]!.laneId).not.toBe('captured-lane');
        expect(clone.objects[0]!.points).toEqual(capturedLane.objects[0]!.points);

        clone.trimPoints![0]!.cp1!.x = 0.99;
        expect(capturedLane.trimPoints![0]!.cp1!.x).toBe(0.1);
        clone.objects[0]!.points[0]!.cp2!.x = 0.99;
        expect(capturedLane.objects[0]!.points[0]!.cp2!.x).toBe(0.7);
    });

    it('does nothing when the capture is empty', () => {
        mocks.state.value = { lanes: [{ ...createAutomationLane('t1', 'pan', 'Pan'), id: 'a' }] };

        cloneClipAutomationLanes([], 'pasted-clip');

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('does nothing when the store is unavailable', () => {
        mocks.state.value = null;

        cloneClipAutomationLanes(
            [{ ...createAutomationLane('t1', 'gain', 'Gain', 0, 1, 'clip-a'), id: 'captured-lane' }],
            'pasted-clip'
        );

        expect(mocks.set).not.toHaveBeenCalled();
    });
});
