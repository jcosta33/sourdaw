import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    bacteriaStore,
    getBacteriaState,
    setBacteriaBandParam,
    setBacteriaParam,
    setBacteriaSnapshotValues,
} from '../../stores/bacteriaStore';
import { applyBacteriaMorphWithAudio } from '../bacteriaParamBridge/applyBacteriaMorph';
import { captureBacteriaSnapshot } from '../bacteriaParamBridge/captureBacteriaSnapshot';
import { paramBatcher } from '../bacteriaParamBridge/helpers';

/**
 * The XY morph's write paths. Capture stores the current flattened patch into
 * a corner; a pad move interpolates the corners and reaches the engine as
 * ordinary scalar `(paramId, value)` writes through the same rAF-batched
 * flush every other Bacteria bridge uses — never a direct store or engine
 * write from the component.
 *
 * The bridge dependencies are mocked at their module boundary so both
 * injectables resolve against the same fakes.
 */

const updateDeviceParam = vi.fn();
const persistDeviceParam = vi.fn();
const resolveEligibleDeviceWriteTarget = vi.fn();

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: (...args: unknown[]) => updateDeviceParam(...args),
}));
vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: null },
    persistDeviceParam: (...args: unknown[]) => persistDeviceParam(...args),
    resolveEligibleDeviceWriteTarget: (...args: unknown[]) => resolveEligibleDeviceWriteTarget(...args),
}));

/** The rAF queue, stubbed so the batcher flushes exactly when the test says. */
let rafCallbacks: Array<(time: number) => void> = [];

function scheduledEngineWrites(): Array<readonly unknown[]> {
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const callback of pending) {
        callback(0);
    }
    return updateDeviceParam.mock.calls.map((call) => Object.freeze(call));
}

function resolveTargetAs(status: 'eligible' | 'missing'): void {
    resolveEligibleDeviceWriteTarget.mockReturnValue(
        status === 'eligible' ? { status: 'eligible', trackId: 'track-1', deviceId: 'dev-1' } : { status: 'missing' }
    );
}

describe('captureBacteriaSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveTargetAs('eligible');
        bacteriaStore.set({});
        paramBatcher.cancelAll();
        rafCallbacks = [];
        vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    it('stores the flattened patch — globals and active band params — into the corner', () => {
        setBacteriaParam('dev-1', 'mix', 0.25);
        setBacteriaParam('dev-1', 'morphX', 0.3);
        setBacteriaBandParam('dev-1', 0, 'drive', 77);

        captureBacteriaSnapshot('dev-1', 2);

        const corner = getBacteriaState('dev-1').patch.snapshots[2]!;
        expect(corner.id).toBe('C');
        expect(corner.paramValues).toMatchObject({ mix: 0.25, band0_drive: 77 });
        // The pad position itself is not a corner value — it would feedback.
        expect(corner.paramValues.morphX).toBeUndefined();
        expect(corner.paramValues.morphY).toBeUndefined();
        // Non-scalar patch metadata is not a corner value either.
        expect(corner.paramValues.name).toBeUndefined();
        expect(corner.paramValues.bands).toBeUndefined();
    });

    it('replaces only the captured corner and keeps the others', () => {
        setBacteriaParam('dev-1', 'mix', 0.75);
        captureBacteriaSnapshot('dev-1', 0);
        setBacteriaParam('dev-1', 'mix', 0.25);
        captureBacteriaSnapshot('dev-1', 3);

        const snapshots = getBacteriaState('dev-1').patch.snapshots;
        expect(snapshots[0]!.paramValues).toMatchObject({ mix: 0.75 });
        expect(snapshots[3]!.paramValues).toMatchObject({ mix: 0.25 });
        expect(snapshots[1]!.paramValues).toEqual({});
        expect(snapshots[2]!.paramValues).toEqual({});
    });

    it('is a no-op for a corner outside the pad', () => {
        setBacteriaParam('dev-1', 'mix', 0.25);
        captureBacteriaSnapshot('dev-1', 9);

        expect(getBacteriaState('dev-1').patch.snapshots[0]!.paramValues).toEqual({});
    });

    it('captures nothing when the device has no eligible write target', () => {
        resolveTargetAs('missing');
        setBacteriaParam('dev-1', 'mix', 0.25);

        captureBacteriaSnapshot('dev-1', 0);

        expect(getBacteriaState('dev-1').patch.snapshots[0]!.paramValues).toEqual({});
    });
});

describe('applyBacteriaMorphWithAudio', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resolveTargetAs('eligible');
        bacteriaStore.set({});
        paramBatcher.cancelAll();
        rafCallbacks = [];
        vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', () => {});
    });

    it('records the position and writes the interpolated scalars through the bridge', () => {
        setBacteriaParam('dev-1', 'mix', 0);
        captureBacteriaSnapshot('dev-1', 0);
        setBacteriaParam('dev-1', 'mix', 1);
        captureBacteriaSnapshot('dev-1', 1);
        setBacteriaParam('dev-1', 'mix', 0);
        captureBacteriaSnapshot('dev-1', 2);
        setBacteriaParam('dev-1', 'mix', 1);
        captureBacteriaSnapshot('dev-1', 3);

        applyBacteriaMorphWithAudio('dev-1', 0.25, 0);

        expect(getBacteriaState('dev-1').patch.morphX).toBe(0.25);
        expect(getBacteriaState('dev-1').patch.morphY).toBe(0);
        expect(scheduledEngineWrites()).toContainEqual(['track-1', 'dev-1', 'mix', 0.25]);
        expect(persistDeviceParam).toHaveBeenCalledWith('dev-1', 'mix', 0.25);
    });

    it('blends all four corners at the center, band params included', () => {
        setBacteriaSnapshotValues('dev-1', 0, { band0_drive: 0, mix: 0 });
        setBacteriaSnapshotValues('dev-1', 1, { band0_drive: 100, mix: 0 });
        setBacteriaSnapshotValues('dev-1', 2, { band0_drive: 0, mix: 1 });
        setBacteriaSnapshotValues('dev-1', 3, { band0_drive: 100, mix: 1 });

        applyBacteriaMorphWithAudio('dev-1', 0.5, 0.5);

        const writes = scheduledEngineWrites();
        expect(writes).toContainEqual(['track-1', 'dev-1', 'band0_drive', 50]);
        expect(writes).toContainEqual(['track-1', 'dev-1', 'mix', 0.5]);
    });

    it('skips a parameter a corner gap leaves out instead of writing a partial value', () => {
        setBacteriaSnapshotValues('dev-1', 0, { drive: 0 });
        setBacteriaSnapshotValues('dev-1', 1, { drive: 100, mix: 1 });
        setBacteriaSnapshotValues('dev-1', 2, { drive: 0 });
        setBacteriaSnapshotValues('dev-1', 3, { drive: 100 });

        applyBacteriaMorphWithAudio('dev-1', 1, 0);

        const writes = scheduledEngineWrites();
        expect(writes).toContainEqual(['track-1', 'dev-1', 'drive', 100]);
        expect(writes.every((call) => call[2] !== 'mix')).toBe(true);
    });

    it('writes nothing while corners are uncaptured, but still records the position', () => {
        applyBacteriaMorphWithAudio('dev-1', 0.3, 0.7);

        expect(getBacteriaState('dev-1').patch.morphX).toBe(0.3);
        expect(getBacteriaState('dev-1').patch.morphY).toBe(0.7);
        expect(scheduledEngineWrites()).toEqual([]);
    });

    it('does not write a band the patch no longer counts', () => {
        for (const corner of [0, 1, 2, 3]) {
            setBacteriaSnapshotValues('dev-1', corner, { band0_gain: 4, band1_gain: 8 });
        }

        applyBacteriaMorphWithAudio('dev-1', 0, 0);

        const writes = scheduledEngineWrites();
        expect(writes).toContainEqual(['track-1', 'dev-1', 'band0_gain', 4]);
        expect(writes.every((call) => call[2] !== 'band1_gain')).toBe(true);
    });

    it('sends nothing when the device has no eligible write target', () => {
        resolveTargetAs('missing');
        setBacteriaSnapshotValues('dev-1', 0, { mix: 0.5 });

        applyBacteriaMorphWithAudio('dev-1', 0, 0);

        expect(scheduledEngineWrites()).toEqual([]);
        // The pad position does not move either — the write was refused.
        expect(getBacteriaState('dev-1').patch.morphX).toBe(0.5);
    });
});
