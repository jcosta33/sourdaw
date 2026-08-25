import { describe, expect, it, vi } from 'vitest';

import { type Store } from '#/infra/store/types';

const mocks = vi.hoisted(() => ({
    executeAppAction: vi.fn().mockResolvedValue(undefined),
    reconcile: vi.fn(),
    trackStore: {
        value: {
            tracks: [
                {
                    devices: [
                        {
                            id: 'grand-1',
                            type: 'grand-boule',
                            deviceState: {
                                version: 1,
                                data: {
                                    modelA: 'balanced-grand',
                                    modelB: 'clear-grand',
                                    morphPosition: 0,
                                    layerBalance: 0,
                                    enabled: false,
                                },
                            },
                        },
                    ],
                },
            ],
        },
    },
}));

vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState, createDefaultGrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleMorphPosition } from '../setGrandBouleMorphPosition';

describe('Grand Boule morph gesture', () => {
    it('coalesces continuous rotary samples into one undoable action', () => {
        let value = createDefaultGrandBouleState();
        const store = {
            get value() {
                return value;
            },
            set(next: GrandBouleState) {
                value = next;
            },
        } as Store<GrandBouleState>;
        const engine = {
            setParam: vi.fn(),
            isReady: () => true,
        } as unknown as GrandBouleEngineHandle;

        setGrandBouleMorphPosition({ deviceId: 'grand-1', engine, store, morphPosition: 0.2, isTransient: true });
        setGrandBouleMorphPosition({ deviceId: 'grand-1', engine, store, morphPosition: 0.6, isTransient: true });
        setGrandBouleMorphPosition({ deviceId: 'grand-1', engine, store, morphPosition: 0.6, isTransient: false });

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'setGrandBouleDeviceState',
                payload: expect.objectContaining({
                    deviceId: 'grand-1',
                    after: expect.objectContaining({ data: expect.objectContaining({ morphPosition: 0.6 }) }),
                }),
            })
        );
    });
});
