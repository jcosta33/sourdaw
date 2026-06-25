import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Store } from '#/infra/store/types';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { createDefaultGrandBouleState } from '../../stores/grandBouleStore';

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

// Import after the mock is registered.
const { setGrandBouleMorphPosition } = await import('../setGrandBouleMorphPosition');

function fakeEngine(): { handle: GrandBouleEngineHandle; setParam: ReturnType<typeof vi.fn> } {
    const setParam = vi.fn();
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
        },
    };
}

function storeWith(value: GrandBouleState | null): Store<GrandBouleState> {
    return { value, set: vi.fn() } as unknown as Store<GrandBouleState>;
}

function stateWithMorph(morph: Partial<GrandBouleState['morph']>): GrandBouleState {
    const base = createDefaultGrandBouleState();
    return { ...base, morph: { ...base.morph, ...morph } };
}

describe('setGrandBouleMorphPosition', () => {
    beforeEach(() => {
        mocks.warn.mockReset();
    });

    it('should export setGrandBouleMorphPosition', () => {
        expect(setGrandBouleMorphPosition).toBeDefined();
    });

    // Regression: prior #30 — an unknown model A id silently no-oped, so a
    // morph-knob move produced neither audio nor any diagnostic.
    it('warns instead of silently no-oping when model A id is unknown', () => {
        const { handle, setParam } = fakeEngine();
        const state = stateWithMorph({ enabled: true, modelA: 'does-not-exist', modelB: 'yamaha-cfx' });

        setGrandBouleMorphPosition({ engine: handle, morphPosition: 0.5, store: storeWith(state) });

        expect(setParam).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledTimes(1);
        expect(mocks.warn.mock.calls[0][0]).toContain('does-not-exist');
    });

    it('warns instead of silently no-oping when model B id is unknown', () => {
        const { handle, setParam } = fakeEngine();
        const state = stateWithMorph({ enabled: true, modelA: 'steinway-d', modelB: 'phantom-piano' });

        setGrandBouleMorphPosition({ engine: handle, morphPosition: 0.5, store: storeWith(state) });

        expect(setParam).not.toHaveBeenCalled();
        expect(mocks.warn).toHaveBeenCalledTimes(1);
        expect(mocks.warn.mock.calls[0][0]).toContain('phantom-piano');
    });

    it('dispatches params and does not warn for a valid morph move', () => {
        const { handle, setParam } = fakeEngine();
        const state = stateWithMorph({ enabled: true, modelA: 'steinway-d', modelB: 'yamaha-cfx' });

        setGrandBouleMorphPosition({ engine: handle, morphPosition: 0.5, store: storeWith(state) });

        expect(setParam).toHaveBeenCalled();
        expect(mocks.warn).not.toHaveBeenCalled();
    });
});
