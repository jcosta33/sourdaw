import { describe, it, expect, vi } from 'vitest';

import { createDisconnectedGrandBouleEngineHandle } from '../../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, createGrandBouleStore } from '../../../stores/grandBouleStore';
import { syncMidiCalibrationToEngine } from '../syncMidiCalibrationToEngine';

function makeStore(overrides: Partial<ReturnType<typeof createDefaultGrandBouleState>['midiCalibration']> = {}) {
    const store = createGrandBouleStore(`sync-${Math.random()}`);
    const state = createDefaultGrandBouleState();
    store.set({ ...state, midiCalibration: { ...state.midiCalibration, ...overrides } });
    return store;
}

describe('syncMidiCalibrationToEngine', () => {
    it('dispatches both engine-consumed values as one setCalibration call', () => {
        // Neither value is its default (0.15 / 5 ms) — at the defaults the
        // wired and unwired engines agree, so a test driven there passes on a
        // control that reaches nothing. The three velocity values are
        // deliberately absent from the call: they shape velocity in
        // TypeScript at note time (`applyVelocityCurve`), and `setCalibration`
        // has no field for them.
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setCalibration = vi.spyOn(engine, 'setCalibration');

        syncMidiCalibrationToEngine({
            engine,
            store: makeStore({ sustainThreshold: 0.4, ccSmoothingMs: 12 }),
        });

        expect(setCalibration).toHaveBeenCalledExactlyOnceWith({ sustainThreshold: 0.4, ccSmoothingMs: 12 });
    });

    it('leaves the engine alone when the device has no state', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setCalibration = vi.spyOn(engine, 'setCalibration');
        const store = createGrandBouleStore(`sync-empty-${Math.random()}`);
        store.clear();

        syncMidiCalibrationToEngine({ engine, store });

        expect(store.value).toBeNull();
        expect(setCalibration).not.toHaveBeenCalled();
    });
});
