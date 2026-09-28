import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A non-transient morph edit used to commit the session store's temperament
 * and preset parameters over project truth. The per-device store is a mirror:
 * another peer's device-state action can retune the piano without the store
 * hearing of it, so a morph drag that sourced those untouched leaves from the
 * store clobbered the chunk's temperament with the stale copy. The drag owns
 * the morph leaves only; temperament and parameters come from the project
 * chunk, read fresh the way `commitGrandBouleDeviceState`'s before-side reads
 * it.
 */

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
    executeUserAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
    trackStore: {
        value: {
            tracks: [
                {
                    devices: [
                        {
                            id: 'grand-1',
                            type: 'grand-boule',
                            parameterValues: {},
                            deviceState: {
                                version: 1,
                                data: {
                                    modelA: 'balanced-grand',
                                    modelB: 'clear-grand',
                                    morphPosition: 0,
                                    layerBalance: 0,
                                    enabled: false,
                                    temperament: 1,
                                    hammerHardness: 0.3,
                                    velocityCurve: 1.25,
                                    stereoWidth: 0.8,
                                    toneTilt: -0.4,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
    reconcile: vi.fn(),
}));

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
import { type GrandBouleState, createDefaultGrandBouleState } from '../../stores/grandBouleStore';
import { dispatchGrandBouleMorphEdit } from '../dispatchGrandBouleMorphEdit';

function storeWith(overrides: Partial<GrandBouleState>): Store<GrandBouleState> {
    let value: GrandBouleState | null = { ...createDefaultGrandBouleState(), ...overrides };
    return {
        get value() {
            return value;
        },
        set(next: GrandBouleState) {
            value = next;
        },
    } as Store<GrandBouleState>;
}

function fakeEngine(): GrandBouleEngineHandle {
    return {
        setParam: vi.fn(),
        isReady: () => true,
    } as unknown as GrandBouleEngineHandle;
}

function dispatchedAfter(): { data: Record<string, unknown> } | undefined {
    const [action] = mocks.executeAppAction.mock.calls.at(-1) ?? [];
    if (action === undefined) {
        return undefined;
    }
    const payload = (action as { payload: { after: { data: Record<string, unknown> } } }).payload;
    return payload.after;
}

describe('dispatchGrandBouleMorphEdit', () => {
    beforeEach(() => {
        mocks.executeAppAction.mockClear();
        mocks.reconcile.mockClear();
    });

    it('commits the temperament the project chunk holds, not the stale store copy', () => {
        const store = storeWith({ temperament: 0 });

        dispatchGrandBouleMorphEdit({
            deviceId: 'grand-1',
            engine: fakeEngine(),
            store,
            nextMorph: { ...createDefaultGrandBouleState().morph, morphPosition: 0.6 },
            isTransient: false,
        });

        const after = dispatchedAfter();
        expect(after).toBeDefined();
        expect(after?.data.temperament).toBe(1);
        expect(after?.data.morphPosition).toBe(0.6);
    });

    it('commits the preset parameters the project chunk holds over stale store parameters', () => {
        const state = createDefaultGrandBouleState();
        const store = storeWith({ parameters: { ...state.parameters, velocityCurve: 0.5 } });

        dispatchGrandBouleMorphEdit({
            deviceId: 'grand-1',
            engine: fakeEngine(),
            store,
            nextMorph: { ...state.morph, morphPosition: 0.2 },
            isTransient: false,
        });

        const after = dispatchedAfter();
        expect(after).toBeDefined();
        expect(after?.data.velocityCurve).toBe(1.25);
        expect(after?.data.hammerHardness).toBe(0.3);
    });

    it('previews a transient drag on the store and engine without committing', () => {
        const engine = fakeEngine();
        const state = createDefaultGrandBouleState();
        const value: GrandBouleState | null = state;
        const set = vi.fn();
        const store = {
            get value() {
                return value;
            },
            set,
        } as unknown as Store<GrandBouleState>;

        dispatchGrandBouleMorphEdit({
            deviceId: 'grand-1',
            engine,
            store,
            nextMorph: { ...state.morph, morphPosition: 0.4 },
            isTransient: true,
        });

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(set).toHaveBeenCalledWith({ ...state, morph: { ...state.morph, morphPosition: 0.4 } });
    });

    it('does nothing when the device has no live store', () => {
        const store = { value: null, set: () => {} } as unknown as Store<GrandBouleState>;

        dispatchGrandBouleMorphEdit({
            deviceId: 'grand-1',
            engine: fakeEngine(),
            store,
            nextMorph: { ...createDefaultGrandBouleState().morph, morphPosition: 0.5 },
            isTransient: false,
        });

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });
});
