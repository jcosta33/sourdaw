import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The pick owns the temperament leaf only. The session store is a mirror
 * another peer's device-state action can leave behind, so the untouched morph
 * and voicing leaves must come from the project chunk — a store stale against
 * the chunk would otherwise revert the chunk's values on an unrelated pick.
 */

const mocks = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: undefined };
    return {
        engine: { setTemperament: vi.fn() },
        executeAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
        executeUserAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
        trackStore,
        reconcile: vi.fn(),
    };
});

vi.mock('../resolveGrandBouleEngine', () => ({ resolveGrandBouleEngine: () => mocks.engine }));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: mocks.executeUserAppAction,
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { type Store } from '#/infra/store/types';

import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleTemperament } from '../setGrandBouleTemperament';

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

describe('setGrandBouleTemperament', () => {
    beforeEach(() => {
        mocks.engine.setTemperament.mockClear();
        mocks.executeAppAction.mockClear();
        mocks.reconcile.mockClear();
        mocks.trackStore.value = undefined;
    });

    it('updates the store and engine and commits the pick', () => {
        const store = liveStore();
        projectChunk({ ...chunkData, temperament: 0 });

        setGrandBouleTemperament({ deviceId: 'grand-1', temperament: 3, store });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.temperament).toBe(3);
        expect(mocks.engine.setTemperament).toHaveBeenCalledWith({ index: 3 });
        expect(dispatchedAfter()).toMatchObject({ temperament: 3 });
    });

    // A store stale against the chunk must not revert the chunk's untouched
    // leaves: the pick sources every leaf but temperament from the fresh
    // chunk, so the chunk's tuning and voicing survive an unrelated pick.
    it('commits the untouched leaves the project chunk holds, not the stale store copy', () => {
        const store = liveStore();
        projectChunk(chunkData);

        setGrandBouleTemperament({ deviceId: 'grand-1', temperament: 3, store });

        expect(dispatchedAfter()).toEqual({
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: -0.2,
            enabled: true,
            temperament: 3,
            hammerHardness: 0.3,
            velocityCurve: 1.25,
            stereoWidth: 0.8,
            toneTilt: -0.4,
        });
    });

    it('does nothing when the device has no live store', () => {
        const store = { value: null, set: () => {} } as unknown as Store<GrandBouleState>;

        expect(() => setGrandBouleTemperament({ deviceId: 'grand-1', temperament: 1, store })).not.toThrow();
        expect(mocks.engine.setTemperament).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });
});
