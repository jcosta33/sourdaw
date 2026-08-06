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

type SetParamSpy = { mock: { calls: readonly (readonly [{ name: string; value: number }])[] } };

/** Every `setParam` payload the engine received, keyed by parameter name. */
function dispatchedParams(setParam: SetParamSpy): Record<string, number> {
    const byName: Record<string, number> = {};
    for (const [payload] of setParam.mock.calls) {
        byName[payload.name] = payload.value;
    }
    return byName;
}

describe('syncMidiCalibrationToEngine', () => {
    it('dispatches a different damper lift point for a different calibration', () => {
        // Two calibrated thresholds, neither of them the 0.15 default — at the
        // default the wired and unwired engines agree, so a test driven there
        // passes on a control that reaches nothing.
        const shallowEngine = createDisconnectedGrandBouleEngineHandle();
        const shallowSetParam = vi.spyOn(shallowEngine, 'setParam');
        const deepEngine = createDisconnectedGrandBouleEngineHandle();
        const deepSetParam = vi.spyOn(deepEngine, 'setParam');

        syncMidiCalibrationToEngine({ engine: shallowEngine, store: makeStore({ sustainThreshold: 0.05 }) });
        syncMidiCalibrationToEngine({ engine: deepEngine, store: makeStore({ sustainThreshold: 0.45 }) });

        expect(dispatchedParams(shallowSetParam).sustain_threshold).toBe(0.05);
        expect(dispatchedParams(deepSetParam).sustain_threshold).toBe(0.45);
    });

    it('dispatches a different CC smoothing constant for a different calibration', () => {
        // 0 ms and 40 ms, either side of the 5 ms default.
        const rawEngine = createDisconnectedGrandBouleEngineHandle();
        const rawSetParam = vi.spyOn(rawEngine, 'setParam');
        const smoothedEngine = createDisconnectedGrandBouleEngineHandle();
        const smoothedSetParam = vi.spyOn(smoothedEngine, 'setParam');

        syncMidiCalibrationToEngine({ engine: rawEngine, store: makeStore({ ccSmoothingMs: 0 }) });
        syncMidiCalibrationToEngine({ engine: smoothedEngine, store: makeStore({ ccSmoothingMs: 40 }) });

        expect(dispatchedParams(rawSetParam).cc_smoothing_ms).toBe(0);
        expect(dispatchedParams(smoothedSetParam).cc_smoothing_ms).toBe(40);
    });

    it('dispatches both engine-consumed values in one sync', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');

        syncMidiCalibrationToEngine({
            engine,
            store: makeStore({ sustainThreshold: 0.4, ccSmoothingMs: 12 }),
        });

        expect(dispatchedParams(setParam)).toEqual({ sustain_threshold: 0.4, cc_smoothing_ms: 12 });
    });

    it('sends nothing engine-side for the three velocity values', () => {
        // Velocity shaping is applied in TypeScript at note time
        // (`applyVelocityCurve`); pushing it as an engine parameter as well
        // would apply the curve twice.
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');

        syncMidiCalibrationToEngine({
            engine,
            store: makeStore({ velocityCurveExponent: 1.8, velocityFloor: 0.3, velocityCeiling: 0.7 }),
        });

        expect(Object.keys(dispatchedParams(setParam)).sort()).toEqual(['cc_smoothing_ms', 'sustain_threshold']);
    });

    it('leaves the engine alone when the device has no state', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');
        const store = createGrandBouleStore(`sync-empty-${Math.random()}`);
        store.clear();

        syncMidiCalibrationToEngine({ engine, store });

        expect(store.value).toBeNull();
        expect(setParam).not.toHaveBeenCalled();
    });
});
