import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    engine: { setTemperament: vi.fn() },
    commit: vi.fn(),
}));

vi.mock('../resolveGrandBouleEngine', () => ({ resolveGrandBouleEngine: () => mocks.engine }));
vi.mock('../commitGrandBouleDeviceState', () => ({ commitGrandBouleDeviceState: mocks.commit }));

import { type Store } from '#/infra/store/types';

import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleTemperament } from '../setGrandBouleTemperament';

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

describe('setGrandBouleTemperament', () => {
    beforeEach(() => {
        mocks.engine.setTemperament.mockClear();
        mocks.commit.mockClear();
    });

    it('updates the store and engine and commits the pick to project truth', () => {
        const store = liveStore();

        setGrandBouleTemperament({ deviceId: 'grand-1', temperament: 1, store });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.temperament).toBe(1);
        expect(mocks.engine.setTemperament).toHaveBeenCalledWith({ index: 1 });
        expect(mocks.commit).toHaveBeenCalledTimes(1);
        expect(mocks.commit).toHaveBeenCalledWith('grand-1', {
            morph: state.morph,
            temperament: 1,
            parameters: state.parameters,
        });
    });

    it('does nothing when the device has no live store', () => {
        const store = { value: null, set: () => {} } as unknown as Store<GrandBouleState>;

        expect(() => setGrandBouleTemperament({ deviceId: 'grand-1', temperament: 1, store })).not.toThrow();
        expect(mocks.engine.setTemperament).not.toHaveBeenCalled();
        expect(mocks.commit).not.toHaveBeenCalled();
    });
});
