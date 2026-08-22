import { describe, it, expect, vi, type Mock } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState, createDefaultGrandBouleState } from '../../stores/grandBouleStore';
import { setGrandBouleMorphBalance } from '../setGrandBouleMorphBalance';
import { setGrandBouleMorphEnabled } from '../setGrandBouleMorphEnabled';
import { setGrandBouleMorphPosition } from '../setGrandBouleMorphPosition';

function fakeEngine(): { handle: GrandBouleEngineHandle; setParam: Mock<GrandBouleEngineHandle['setParam']> } {
    const setParam = vi.fn<GrandBouleEngineHandle['setParam']>();
    return {
        setParam,
        handle: {
            noteOn: vi.fn(),
            noteOnMidi2: vi.fn(),
            noteOff: vi.fn(),
            setParam,
            setSustain: vi.fn(),
            setUnaCorda: vi.fn(),
            setSostenuto: vi.fn(),
            setTemperament: vi.fn(),
            loadAttackClip: vi.fn(),
            allNotesOff: vi.fn(),
            isReady: () => true,
            getAnalyserNode: () => null,
            sampleRate: () => 44100,
        },
    };
}

function storeWith(value: GrandBouleState | null): { store: Store<GrandBouleState>; set: Mock } {
    const set = vi.fn();
    return { store: { value, set } as unknown as Store<GrandBouleState>, set };
}

function paramsByName(setParam: Mock<GrandBouleEngineHandle['setParam']>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const call of setParam.mock.calls) {
        result[call[0].name] = call[0].value;
    }
    return result;
}

function expectParamsClose(setParam: Mock<GrandBouleEngineHandle['setParam']>, expected: Record<string, number>): void {
    const actual = paramsByName(setParam);
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
    for (const [name, value] of Object.entries(expected)) {
        expect(actual[name]).toBeCloseTo(value, 12);
    }
}

describe('setGrandBouleMorphPosition', () => {
    it('does nothing when state is null', () => {
        const { handle, setParam } = fakeEngine();
        const { store, set } = storeWith(null);

        setGrandBouleMorphPosition({ store, engine: handle, morphPosition: 0.5 });

        expect(set).not.toHaveBeenCalled();
        expect(setParam).not.toHaveBeenCalled();
    });

    it('dispatches model A parameters directly when morph is disabled, ignoring layer B', () => {
        const { handle, setParam } = fakeEngine();
        const state = createDefaultGrandBouleState();
        // Defaults: balanced-grand to clear-grand, with morph disabled.
        const { store, set } = storeWith(state);

        setGrandBouleMorphPosition({ store, engine: handle, morphPosition: 0.9 });

        // Disabled morph always plays modelA's raw parameters, regardless of position.
        expectParamsClose(setParam, {
            hammer_hardness_scale: 0.92,
            hammer_mass_scale: 1.08,
            soundboard_brightness: 0.48,
            sympathetic_level: 0.58,
            body_resonance: 0.52,
            tone_color: -0.08,
        });
        expect(set).toHaveBeenCalledWith({
            ...state,
            morph: { ...state.morph, morphPosition: 0.9 },
        });
    });

    it('clamps morphPosition above 1 down to 1 before persisting', () => {
        const { handle } = fakeEngine();
        const state = createDefaultGrandBouleState();
        const { store, set } = storeWith(state);

        setGrandBouleMorphPosition({ store, engine: handle, morphPosition: 5 });

        expect(set).toHaveBeenCalledWith({ ...state, morph: { ...state.morph, morphPosition: 1 } });
    });

    it('clamps a negative morphPosition up to 0 before persisting', () => {
        const { handle } = fakeEngine();
        const state = createDefaultGrandBouleState();
        const { store, set } = storeWith(state);

        setGrandBouleMorphPosition({ store, engine: handle, morphPosition: -3 });

        expect(set).toHaveBeenCalledWith({ ...state, morph: { ...state.morph, morphPosition: 0 } });
    });

    it('linearly interpolates every physical-modeling parameter between model A and B when enabled', () => {
        const { handle, setParam } = fakeEngine();
        const state = {
            ...createDefaultGrandBouleState(),
            morph: { ...createDefaultGrandBouleState().morph, enabled: true },
        };
        const { store, set } = storeWith(state);

        // balanced-grand to clear-grand at t = 0.5.
        setGrandBouleMorphPosition({ store, engine: handle, morphPosition: 0.5 });

        expectParamsClose(setParam, {
            hammer_hardness_scale: 1.13,
            hammer_mass_scale: 0.95,
            soundboard_brightness: 0.63,
            sympathetic_level: 0.47,
            body_resonance: 0.47,
            tone_color: 0.24,
        });
        expect(set).toHaveBeenCalledWith({
            ...state,
            morph: { ...state.morph, morphPosition: 0.5 },
        });
    });

    it('reapplies the current morph position immediately when morph is enabled', () => {
        const { handle, setParam } = fakeEngine();
        const state = {
            ...createDefaultGrandBouleState(),
            morph: { ...createDefaultGrandBouleState().morph, morphPosition: 0.25 },
        };
        const { store, set } = storeWith(state);

        setGrandBouleMorphEnabled({ store, engine: handle, enabled: true });

        expectParamsClose(setParam, {
            hammer_hardness_scale: 1.025,
            hammer_mass_scale: 1.0150000000000001,
            soundboard_brightness: 0.555,
            sympathetic_level: 0.525,
            body_resonance: 0.495,
            tone_color: 0.08,
        });
        expect(set).toHaveBeenCalledWith({ ...state, morph: { ...state.morph, enabled: true } });
    });

    it.each([
        [-1, 0.92],
        [0, 1.025],
        [1, 1.34],
    ])('maps layer balance %s to the documented A/current/B interpolation', (balance, hardness) => {
        const { handle, setParam } = fakeEngine();
        const state = {
            ...createDefaultGrandBouleState(),
            morph: { ...createDefaultGrandBouleState().morph, enabled: true, morphPosition: 0.25 },
        };
        const { store, set } = storeWith(state);

        setGrandBouleMorphBalance({ store, engine: handle, balance });

        expect(paramsByName(setParam).hammer_hardness_scale).toBeCloseTo(hardness, 10);
        expect(set).toHaveBeenCalledWith({ ...state, morph: { ...state.morph, layerBalance: balance } });
    });

    it('warns and does nothing when model A is unknown, without touching the store or engine', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const { handle, setParam } = fakeEngine();
        const state = {
            ...createDefaultGrandBouleState(),
            morph: { ...createDefaultGrandBouleState().morph, modelA: 'not-a-real-model' },
        };
        const { store, set } = storeWith(state);

        setGrandBouleMorphPosition({ store, engine: handle, morphPosition: 0.5 });

        expect(setParam).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-real-model'));
        warn.mockRestore();
    });

    it('warns and does nothing when morph is enabled but model B is unknown', () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const { handle, setParam } = fakeEngine();
        const state = {
            ...createDefaultGrandBouleState(),
            morph: { ...createDefaultGrandBouleState().morph, enabled: true, modelB: 'not-a-real-model' },
        };
        const { store, set } = storeWith(state);

        setGrandBouleMorphPosition({ store, engine: handle, morphPosition: 0.5 });

        expect(setParam).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-a-real-model'));
        warn.mockRestore();
    });
});
