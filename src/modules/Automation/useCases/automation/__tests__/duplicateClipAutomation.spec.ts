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

const { duplicateClipAutomation } = await import('../duplicateClipAutomation');

describe('duplicateClipAutomation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('copies lanes belonging to the source clip onto the new clip', () => {
        const sourcePoint: AutomationPoint = {
            beat: 0,
            value: 0.5,
            curve: 'bezier',
            tension: 0,
            cp1: { x: 0.2, y: 0.3 },
        };
        const sourceLane = {
            ...createAutomationLane('t1', 'gain', 'Gain'),
            id: 'source',
            clipId: 'clip-a',
            visible: false,
            points: [sourcePoint],
        };
        const otherLane = { ...createAutomationLane('t1', 'pan', 'Pan'), id: 'other', clipId: 'clip-b' };
        mocks.state.value = { lanes: [sourceLane, otherLane] };

        duplicateClipAutomation('clip-a', 'clip-c');

        const lanes = mocks.state.value.lanes;
        expect(lanes).toHaveLength(3);
        const copy = lanes[2]!;
        expect(copy.clipId).toBe('clip-c');
        expect(copy.visible).toBe(false);
        expect(copy.points).toEqual([sourcePoint]);

        copy.points[0]!.cp1!.x = 0.99;
        expect(sourcePoint.cp1!.x).toBe(0.2);
    });

    it('carries every persisted lane field onto the copy and re-pins object lane ids', () => {
        const sourceLane: AutomationLane = {
            ...createAutomationLane('t1', 'gain', 'Gain'),
            id: 'source',
            clipId: 'clip-a',
            clipAutomationMode: 'multiplicative',
            points: [{ beat: 0, value: 0.5, curve: 'linear', tension: 0 }],
            trimPoints: [{ beat: 1, value: 0.2, curve: 'bezier', tension: 0, cp1: { x: 0.1, y: 0.2 } }],
            ghostPoints: [{ beat: 2, value: 0.3, curve: 'stairs', tension: 0, stairSteps: 4 }],
            objects: [
                {
                    id: 'obj-1',
                    laneId: 'source',
                    startBeat: 0,
                    endBeat: 4,
                    points: [{ beat: 0, value: 0.5, curve: 'bezier', tension: 0, cp2: { x: 0.7, y: 0.8 } }],
                    name: 'Container',
                },
            ],
        };
        mocks.state.value = { lanes: [sourceLane] };

        duplicateClipAutomation('clip-a', 'clip-c');

        const copy = mocks.state.value.lanes[1]!;
        // The copy must survive the store's exact-shape check unchanged: a
        // missing field or a minted `cp1: undefined` key would force a
        // normalize repair on the next hydrate instead of the identity path.
        expect(is_exact_automation_lane(copy)).toBe(true);
        expect(copy.clipAutomationMode).toBe('multiplicative');
        expect(copy.trimPoints).toEqual(sourceLane.trimPoints);
        expect(copy.ghostPoints).toEqual(sourceLane.ghostPoints);
        expect(copy.objects).toHaveLength(1);
        expect(copy.objects[0]!.laneId).toBe(copy.id);
        expect(copy.objects[0]!.laneId).not.toBe('source');
        expect(copy.objects[0]!.points).toEqual(sourceLane.objects[0]!.points);

        copy.trimPoints![0]!.cp1!.x = 0.99;
        expect(sourceLane.trimPoints![0]!.cp1!.x).toBe(0.1);
        copy.objects[0]!.points[0]!.cp2!.x = 0.99;
        expect(sourceLane.objects[0]!.points[0]!.cp2!.x).toBe(0.7);
    });

    it('does nothing when no lane matches the source clip', () => {
        mocks.state.value = {
            lanes: [{ ...createAutomationLane('t1', 'gain', 'Gain'), id: 'a', clipId: 'clip-b' }],
        };

        duplicateClipAutomation('clip-a', 'clip-c');

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('does nothing when the store is unavailable', () => {
        mocks.state.value = null;
        duplicateClipAutomation('clip-a', 'clip-c');
        expect(mocks.set).not.toHaveBeenCalled();
    });
});
