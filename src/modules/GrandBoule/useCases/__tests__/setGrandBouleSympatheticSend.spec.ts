import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';

import { createDisconnectedGrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleSympatheticSend } from '../setGrandBouleSympatheticSend';

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

/** Seeded away from the default 0.25 so a restored default cannot pass as a write. */
function seededStore() {
    const state = createDefaultGrandBouleState();
    return createStore<GrandBouleState>({
        initialData: { ...state, config: { ...state.config, sympatheticSend: 0.02 } },
    });
}

describe('setGrandBouleSympatheticSend', () => {
    beforeEach(() => {
        dispatched.length = 0;
        engineWrites.length = 0;
    });

    it('previews on the engine and the store without touching project truth', () => {
        const store = seededStore();

        setGrandBouleSympatheticSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.66, isTransient: true });

        expect(store.value?.config.sympatheticSend).toBe(0.66);
        expect(engineWrites).toEqual([{ name: 'sympatheticSend', value: 0.66 }]);
        expect(dispatched).toEqual([]);
    });

    it('commits through setDeviceParameter and waits for project truth before changing the session', () => {
        const store = seededStore();

        setGrandBouleSympatheticSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.66 });

        expect(store.value?.config.sympatheticSend).toBe(0.02);
        expect(dispatched).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'gb-1', paramId: 'sympatheticSend', value: 0.66 } },
        ]);
        expect(engineWrites).toEqual([]);
    });

    it('clamps to the declared 0..1 range', () => {
        const store = seededStore();

        setGrandBouleSympatheticSend({ deviceId: 'gb-1', engine: engine(), store, amount: 12 });
        expect(dispatched).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'gb-1', paramId: 'sympatheticSend', value: 1 } },
        ]);
        expect(store.value?.config.sympatheticSend).toBe(0.02);

        setGrandBouleSympatheticSend({ deviceId: 'gb-1', engine: engine(), store, amount: -7, isTransient: true });
        expect(store.value?.config.sympatheticSend).toBe(0);
        expect(engineWrites).toEqual([{ name: 'sympatheticSend', value: 0 }]);
    });

    it('leaves every other config field alone', () => {
        const store = seededStore();
        const before = store.value!.config;

        setGrandBouleSympatheticSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.8 });

        expect(store.value?.config.masterGain).toBe(before.masterGain);
        expect(store.value?.config.soundboardSend).toBe(before.soundboardSend);
    });

    it('does nothing when the store holds no state', () => {
        const store = createStore<GrandBouleState>();

        setGrandBouleSympatheticSend({ deviceId: 'gb-1', engine: engine(), store, amount: 0.66 });

        expect(store.value).toBeNull();
        expect(dispatched).toEqual([]);
        expect(engineWrites).toEqual([]);
    });
});
