import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';

import { createDisconnectedGrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleSoundboardSend } from '../setGrandBouleSoundboardSend';

const dispatched: { type: string; payload: unknown }[] = [];

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    executeUserAppAction: (action: { type: string; payload: unknown }) => {
        dispatched.push(action);
        return Promise.resolve({ status: 'ok' });
    },
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

const engineWrites: { name: string; value: number }[] = [];

function engine() {
    return {
        ...createDisconnectedGrandBouleEngineHandle(),
        setParam: ({ name, value }: { name: string; value: number }) => {
            engineWrites.push({ name, value });
        },
    };
}

/** Seeded away from the default 0.6 so a restored default cannot pass as a write. */
function seededStore() {
    const state = createDefaultGrandBouleState();
    return createStore<GrandBouleState>({
        initialData: { ...state, config: { ...state.config, soundboardSend: 0.05 } },
    });
}

describe('setGrandBouleSoundboardSend', () => {
    beforeEach(() => {
        dispatched.length = 0;
        engineWrites.length = 0;
    });

    it('previews on the engine and the store without touching project truth', () => {
        const store = seededStore();

        setGrandBouleSoundboardSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.42, isTransient: true });

        expect(store.value?.config.soundboardSend).toBe(0.42);
        expect(engineWrites).toEqual([{ name: 'soundboardSend', value: 0.42 }]);
        expect(dispatched).toEqual([]);
    });

    it('commits through setDeviceParameter and waits for project truth before changing the session', () => {
        const store = seededStore();

        setGrandBouleSoundboardSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.42 });

        expect(store.value?.config.soundboardSend).toBe(0.05);
        expect(dispatched).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'gb-1', paramId: 'soundboardSend', value: 0.42 } },
        ]);
        expect(engineWrites).toEqual([]);
    });

    it('clamps to the declared 0..1 range', () => {
        const store = seededStore();

        setGrandBouleSoundboardSend({ deviceId: 'gb-1', engine: engine(), store, amount: 4 });
        expect(dispatched).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'gb-1', paramId: 'soundboardSend', value: 1 } },
        ]);
        expect(store.value?.config.soundboardSend).toBe(0.05);

        setGrandBouleSoundboardSend({ deviceId: 'gb-1', engine: engine(), store, amount: -0.5, isTransient: true });
        expect(store.value?.config.soundboardSend).toBe(0);
        expect(engineWrites).toEqual([{ name: 'soundboardSend', value: 0 }]);
    });

    it('leaves every other config field alone', () => {
        const store = seededStore();
        const before = store.value!.config;

        setGrandBouleSoundboardSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.9 });

        expect(store.value?.config.masterGain).toBe(before.masterGain);
        expect(store.value?.config.sympatheticSend).toBe(before.sympatheticSend);
    });

    it('does nothing when the store holds no state', () => {
        const store = createStore<GrandBouleState>();

        setGrandBouleSoundboardSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.42 });

        expect(store.value).toBeNull();
        expect(dispatched).toEqual([]);
        expect(engineWrites).toEqual([]);
    });
});
