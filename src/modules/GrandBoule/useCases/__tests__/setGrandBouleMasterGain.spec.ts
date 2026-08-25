import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';

import { createDisconnectedGrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleMasterGain } from '../setGrandBouleMasterGain';

const dispatched: { type: string; payload: unknown }[] = [];

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (action: { type: string; payload: unknown }) => {
        dispatched.push(action);
        return Promise.resolve({ status: 'ok' });
    },
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

/** Seeded away from the default 0.1 so a restored default cannot pass as a write. */
function seededStore() {
    const state = createDefaultGrandBouleState();
    return createStore<GrandBouleState>({
        initialData: { ...state, config: { ...state.config, masterGain: 0.15 } },
    });
}

describe('setGrandBouleMasterGain', () => {
    beforeEach(() => {
        dispatched.length = 0;
        engineWrites.length = 0;
    });

    it('previews on the engine and the store without touching project truth', () => {
        const store = seededStore();

        setGrandBouleMasterGain({ deviceId: 'gb-1', engine: engine(), store, gain: 0.75, isTransient: true });

        expect(store.value?.config.masterGain).toBe(0.75);
        // camelCase reaches the engine and `PARAM_MAP` translates it; the previous
        // hand-written 'master_gain' bypassed the one table that owns that mapping.
        expect(engineWrites).toEqual([{ name: 'masterGain', value: 0.75 }]);
        expect(dispatched).toEqual([]);
    });

    it('commits through setDeviceParameter and waits for project truth before changing the session', () => {
        const store = seededStore();

        setGrandBouleMasterGain({ deviceId: 'gb-1', engine: engine(), store, gain: 0.75 });

        expect(store.value?.config.masterGain).toBe(0.15);
        expect(dispatched).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'gb-1', paramId: 'masterGain', value: 0.75 } },
        ]);
        expect(engineWrites).toEqual([]);
    });

    it('clamps to the declared 0..1 range in both halves', () => {
        const store = seededStore();

        setGrandBouleMasterGain({ deviceId: 'gb-1', engine: engine(), store, gain: 7.5 });
        expect(dispatched).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'gb-1', paramId: 'masterGain', value: 1 } },
        ]);
        expect(store.value?.config.masterGain).toBe(0.15);

        setGrandBouleMasterGain({ deviceId: 'gb-1', engine: engine(), store, gain: -3, isTransient: true });
        expect(store.value?.config.masterGain).toBe(0);
        expect(engineWrites).toEqual([{ name: 'masterGain', value: 0 }]);
    });

    it('leaves every other config field alone', () => {
        const store = seededStore();
        const before = store.value!.config;

        setGrandBouleMasterGain({ deviceId: 'gb-1', engine: engine(), store, gain: 0.9 });

        expect(store.value?.config.soundboardSend).toBe(before.soundboardSend);
        expect(store.value?.config.sympatheticSend).toBe(before.sympatheticSend);
        expect(store.value?.config.stretchAmount).toBe(before.stretchAmount);
    });

    it('does nothing when the store holds no state', () => {
        const store = createStore<GrandBouleState>();

        setGrandBouleMasterGain({ deviceId: 'gb-1', engine: engine(), store, gain: 0.75 });

        expect(store.value).toBeNull();
        expect(dispatched).toEqual([]);
        expect(engineWrites).toEqual([]);
    });
});
