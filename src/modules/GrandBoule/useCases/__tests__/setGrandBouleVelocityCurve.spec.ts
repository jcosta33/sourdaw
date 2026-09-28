import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * The settle owns the velocityCurve leaf only. The session store is a mirror
 * another peer's device-state action can leave behind, so the untouched morph,
 * temperament and voicing leaves must come from the project chunk — a store
 * stale against the chunk would otherwise revert the chunk's values on
 * release, and turn even a no-change gesture into a clobber.
 */

const mocks = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: undefined };
    return {
        executeAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
        executeUserAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
        trackStore,
        reconcile: vi.fn(),
    };
});

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: mocks.executeUserAppAction,
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleVelocityCurve } from '../setGrandBouleVelocityCurve';

const chunkData = {
    modelA: 'mellow-grand',
    modelB: 'singing-grand',
    morphPosition: 0.4,
    layerBalance: -0.2,
    enabled: true,
    temperament: 1,
    hammerHardness: 0.3,
    velocityCurve: 1.25,
    stereoWidth: 0.8,
    toneTilt: -0.4,
};

function fakeEngine(): { handle: GrandBouleEngineHandle; setParam: Mock<GrandBouleEngineHandle['setParam']> } {
    const setParam = vi.fn<GrandBouleEngineHandle['setParam']>();
    return {
        setParam,
        handle: {
            noteOn: vi.fn(),
            noteOnMidi2: vi.fn(),
            noteOff: vi.fn(),
            setParam,
            setCalibration: vi.fn(),
            setSustain: vi.fn(),
            setUnaCorda: vi.fn(),
            setSostenuto: vi.fn(),
            setTemperament: vi.fn(),
            allNotesOff: vi.fn(),
            isReady: () => true,
            getAnalyserNode: () => null,
            sampleRate: () => 44100,
        },
    };
}

function liveStore(): Store<GrandBouleState> {
    let value: GrandBouleState | null = createDefaultGrandBouleState();
    return {
        get value() {
            return value;
        },
        set(next: GrandBouleState) {
            value = next;
        },
    } as Store<GrandBouleState>;
}

function projectChunk(data: Record<string, unknown>): void {
    mocks.trackStore.value = {
        tracks: [
            {
                devices: [
                    { id: 'grand-1', type: 'grand-boule', parameterValues: {}, deviceState: { version: 1, data } },
                ],
            },
        ],
    };
}

function dispatchedAfter(): Record<string, unknown> | undefined {
    const [action] = mocks.executeAppAction.mock.calls.at(-1) ?? [];
    if (action === undefined) {
        return undefined;
    }
    return (action as { payload: { after: { data: Record<string, unknown> } } }).payload.after.data;
}

describe('setGrandBouleVelocityCurve', () => {
    beforeEach(() => {
        mocks.executeAppAction.mockClear();
        mocks.reconcile.mockClear();
        mocks.trackStore.value = undefined;
    });

    // A store stale against the chunk must not revert the chunk's untouched
    // leaves: the settle sources every leaf but velocityCurve from the fresh
    // chunk, so the chunk's temperament and voicing survive a curve release.
    it('commits the settled curve and the untouched leaves the project chunk holds', () => {
        const store = liveStore();
        const { handle, setParam } = fakeEngine();
        projectChunk(chunkData);

        setGrandBouleVelocityCurve({ deviceId: 'grand-1', engine: handle, exponent: 0.9, store });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.parameters.velocityCurve).toBe(0.9);
        expect(setParam).toHaveBeenCalledWith({ name: 'velocity_curve', value: 0.9 });
        expect(dispatchedAfter()).toEqual({
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: -0.2,
            enabled: true,
            temperament: 1,
            hammerHardness: 0.3,
            velocityCurve: 0.9,
            stereoWidth: 0.8,
            toneTilt: -0.4,
        });
    });

    // Releasing the knob where the chunk already sits changes nothing: with
    // every untouched leaf chunk-sourced, the no-op guard compares
    // like-for-like and suppresses the action — a stale store must not turn
    // the no-op gesture into a clobber of the chunk's values.
    it('suppresses a no-change release instead of dispatching a stale-store clobber', () => {
        const store = liveStore();
        const { handle, setParam } = fakeEngine();
        projectChunk(chunkData);

        setGrandBouleVelocityCurve({ deviceId: 'grand-1', engine: handle, exponent: 1.25, store });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.parameters.velocityCurve).toBe(1.25);
        expect(setParam).toHaveBeenCalledWith({ name: 'velocity_curve', value: 1.25 });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    });

    it('previews a transient drag on the store and engine without committing', () => {
        const store = liveStore();
        const { handle, setParam } = fakeEngine();
        // The device must exist in project truth or the no-commit assertion is
        // toothless: `commitGrandBouleDeviceState` returns before dispatching
        // for an unfindable device, so without a chunk-carrier the gate would
        // never be the thing keeping `executeAppAction` silent. The previewed
        // 0.7 differs from the chunk's 1.25, so a deleted transient gate
        // dispatches and fails this case.
        projectChunk(chunkData);

        setGrandBouleVelocityCurve({
            deviceId: 'grand-1',
            engine: handle,
            exponent: 0.7,
            store,
            isTransient: true,
        });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.parameters.velocityCurve).toBe(0.7);
        expect(setParam).toHaveBeenCalledWith({ name: 'velocity_curve', value: 0.7 });
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.reconcile).not.toHaveBeenCalled();
    });

    it('clamps the exponent into the declared 0.5..2 range before storing and committing', () => {
        const store = liveStore();
        const { handle, setParam } = fakeEngine();
        projectChunk(chunkData);

        setGrandBouleVelocityCurve({ deviceId: 'grand-1', engine: handle, exponent: 5, store });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.parameters.velocityCurve).toBe(2);
        expect(setParam).toHaveBeenCalledWith({ name: 'velocity_curve', value: 2 });
        expect(dispatchedAfter()).toMatchObject({ velocityCurve: 2 });
    });

    it('does nothing when the device has no live store', () => {
        const store = { value: null, set: () => {} } as unknown as Store<GrandBouleState>;
        const { handle } = fakeEngine();

        expect(() =>
            setGrandBouleVelocityCurve({ deviceId: 'grand-1', engine: handle, exponent: 1, store })
        ).not.toThrow();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });
});
