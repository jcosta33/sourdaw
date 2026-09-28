import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const mocks = vi.hoisted(() => ({
    commit: vi.fn(),
}));

vi.mock('../commitGrandBouleDeviceState', () => ({ commitGrandBouleDeviceState: mocks.commit }));

import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleVelocityCurve } from '../setGrandBouleVelocityCurve';

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

describe('setGrandBouleVelocityCurve', () => {
    beforeEach(() => {
        mocks.commit.mockClear();
    });

    it('commits the settled curve to project truth through the device-addressed action', () => {
        const store = liveStore();
        const { handle, setParam } = fakeEngine();

        setGrandBouleVelocityCurve({ deviceId: 'grand-1', engine: handle, exponent: 1.4, store });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.parameters.velocityCurve).toBe(1.4);
        expect(setParam).toHaveBeenCalledWith({ name: 'velocity_curve', value: 1.4 });
        expect(mocks.commit).toHaveBeenCalledTimes(1);
        expect(mocks.commit).toHaveBeenCalledWith('grand-1', {
            morph: state.morph,
            temperament: state.temperament,
            parameters: { ...state.parameters, velocityCurve: 1.4 },
        });
    });

    it('previews a transient drag on the store and engine without committing', () => {
        const store = liveStore();
        const { handle, setParam } = fakeEngine();

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
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    it('clamps the exponent into the declared 0.5..2 range before storing and committing', () => {
        const store = liveStore();
        const { handle, setParam } = fakeEngine();

        setGrandBouleVelocityCurve({ deviceId: 'grand-1', engine: handle, exponent: 5, store });

        const state = store.value;
        if (state === null) {
            throw new Error('Expected a live Grand Boule store');
        }
        expect(state.parameters.velocityCurve).toBe(2);
        expect(setParam).toHaveBeenCalledWith({ name: 'velocity_curve', value: 2 });
        expect(mocks.commit).toHaveBeenCalledWith(
            'grand-1',
            expect.objectContaining({ parameters: expect.objectContaining({ velocityCurve: 2 }) })
        );
    });

    it('does nothing when the device has no live store', () => {
        const store = { value: null, set: () => {} } as unknown as Store<GrandBouleState>;
        const { handle } = fakeEngine();

        expect(() =>
            setGrandBouleVelocityCurve({ deviceId: 'grand-1', engine: handle, exponent: 1, store })
        ).not.toThrow();
        expect(mocks.commit).not.toHaveBeenCalled();
    });
});
