import { describe, it, expect, vi, type Mock } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState, createDefaultGrandBouleState } from '../../stores/grandBouleStore';
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
        expect(paramsByName(setParam)).toEqual({
            hammer_hardness_scale: 1.0,
            hammer_mass_scale: 1.0,
            soundboard_brightness: 0.55,
            sympathetic_level: 0.5,
            body_resonance: 0.6,
            tone_color: 0.0,
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

        expect(paramsByName(setParam)).toEqual({
            hammer_hardness_scale: 1.25, // lerp(1.0, 1.5, 0.5)
            hammer_mass_scale: 0.85, // lerp(1.0, 0.7, 0.5)
            soundboard_brightness: 0.7, // lerp(0.55, 0.85, 0.5)
            sympathetic_level: 0.4, // lerp(0.5, 0.3, 0.5)
            body_resonance: 0.475, // lerp(0.6, 0.35, 0.5)
            tone_color: 0.35, // lerp(0.0, 0.7, 0.5)
        });
        expect(set).toHaveBeenCalledWith({
            ...state,
            morph: { ...state.morph, morphPosition: 0.5 },
        });
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
