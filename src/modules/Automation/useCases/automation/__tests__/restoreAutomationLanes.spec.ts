import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationLane } from '../../../models/Automation';
import type { AutomationStoreState } from '../../../stores/automationStore';

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

const { restoreAutomationLanes } = await import('../restoreAutomationLanes');

function createLane(id: string, parameterName = `Parameter ${id}`): AutomationLane {
    return {
        id,
        trackId: 'track-1',
        parameterId: `parameter-${id}`,
        parameterName,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function createSparseArray(): unknown[] {
    const values: unknown[] = [];
    values.length = 1;
    return values;
}

function createAutomationObject(laneId: string, points: unknown[]) {
    return {
        id: `object-${laneId}`,
        laneId,
        startBeat: 0,
        endBeat: 1,
        points,
        name: 'Object',
    };
}

const SPARSE_SNAPSHOT_CASES = [
    {
        label: 'lane points',
        snapshot: { ...createLane('lane-sparse-points'), points: createSparseArray() },
    },
    {
        label: 'lane objects',
        snapshot: { ...createLane('lane-sparse-objects'), objects: createSparseArray() },
    },
    {
        label: 'trim points',
        snapshot: { ...createLane('lane-sparse-trim'), trimPoints: createSparseArray() },
    },
    {
        label: 'ghost points',
        snapshot: { ...createLane('lane-sparse-ghost'), ghostPoints: createSparseArray() },
    },
    {
        label: 'nested automation-object points',
        snapshot: {
            ...createLane('lane-sparse-object-points'),
            objects: [createAutomationObject('lane-sparse-object-points', createSparseArray())],
        },
    },
] satisfies readonly { label: string; snapshot: unknown }[];

describe('restoreAutomationLanes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = { lanes: [] };
    });

    it('should preserve restore-batch duplicate ids while skipping every id already current', () => {
        const current = createLane('lane-current', 'Current');
        const newerCurrent = createLane('lane-replaced', 'Newer current');
        const restored = createLane('lane-restored', 'Restored');
        const staleSnapshot = createLane('lane-replaced', 'Stale snapshot');
        const duplicateSnapshot = createLane('lane-restored', 'Duplicate snapshot');
        const duplicateStaleSnapshot = createLane('lane-replaced', 'Duplicate stale snapshot');
        mocks.state.value = { lanes: [current, newerCurrent] };

        restoreAutomationLanes([restored, staleSnapshot, duplicateSnapshot, duplicateStaleSnapshot]);

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(mocks.state.value).toEqual({
            lanes: [current, newerCurrent, restored, duplicateSnapshot],
        });
        expect(mocks.state.value.lanes[0]).toBe(current);
        expect(mocks.state.value.lanes[1]).toBe(newerCurrent);
        expect(mocks.state.value.lanes[2]).toBe(restored);
        expect(mocks.state.value.lanes[3]).toBe(duplicateSnapshot);
    });

    it('should reject a malformed batch atomically without restoring valid neighboring lanes', () => {
        const current = createLane('lane-current', 'Current');
        const validSnapshot = createLane('lane-valid', 'Valid');
        const malformedSnapshot = {
            ...createLane('lane-invalid', 'Invalid'),
            points: [{ beat: 0, value: 0.5, curve: 'invalid', tension: 0 }],
        };
        const previousState: AutomationStoreState = { lanes: [current] };
        mocks.state.value = previousState;

        restoreAutomationLanes([validSnapshot, malformedSnapshot]);

        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
        expect(mocks.state.value).toEqual({ lanes: [current] });
    });

    it.each(SPARSE_SNAPSHOT_CASES)('should reject sparse $label atomically', ({ snapshot }) => {
        const current = createLane('lane-current', 'Current');
        const validSnapshot = createLane('lane-valid', 'Valid');
        const previousState: AutomationStoreState = { lanes: [current] };
        mocks.state.value = previousState;

        restoreAutomationLanes([validSnapshot, snapshot]);

        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
        expect(mocks.state.value).toEqual({ lanes: [current] });
    });

    it('should not read or write for an empty snapshot list', () => {
        restoreAutomationLanes([]);

        expect(mocks.getValue).not.toHaveBeenCalled();
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toEqual({ lanes: [] });
    });

    it('should not write when owner state is unavailable', () => {
        mocks.state.value = null;

        restoreAutomationLanes([createLane('lane-restored')]);

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBeNull();
    });
});
