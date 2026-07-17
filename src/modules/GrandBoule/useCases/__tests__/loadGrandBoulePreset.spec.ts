import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { createDefaultGrandBouleConfig } from '../../models/GrandBouleConfig';
import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { createDefaultMorphState } from '../../models/GrandBouleMorphState';
import { createNeutralPresetParameters } from '../../models/GrandBoulePreset';
import { findBuiltinGrandBoulePreset } from '../../repositories/findBuiltinGrandBoulePreset';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { loadGrandBoulePreset } from '../loadGrandBoulePreset';

const gbStoreCell = vi.hoisted(() => ({
    value: null as GrandBouleState | null,
    set: vi.fn(),
}));

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
            sampleRate: () => 48000,
        },
    };
}

vi.mock('../../stores/grandBouleStore', () => ({
    grandBouleStore: gbStoreCell,
}));

vi.mock('../../repositories/findBuiltinGrandBoulePreset', () => ({
    findBuiltinGrandBoulePreset: vi.fn(),
}));

describe('loadGrandBoulePreset', () => {
    beforeEach(() => {
        gbStoreCell.value = null;
        gbStoreCell.set.mockClear();
    });

    it('should return false when preset id is unknown', () => {
        vi.mocked(findBuiltinGrandBoulePreset).mockReturnValue(null);

        const { handle } = fakeEngine();
        expect(loadGrandBoulePreset({ engine: handle, store: gbStoreCell as never, presetId: 'nope' })).toBe(false);
        expect(gbStoreCell.set).not.toHaveBeenCalled();
    });

    it('should return false when preset exists but store is empty', () => {
        const params = createNeutralPresetParameters();
        vi.mocked(findBuiltinGrandBoulePreset).mockReturnValue({
            id: 'ok',
            name: 'OK',
            description: '',
            parameters: params,
        });

        const { handle } = fakeEngine();
        expect(loadGrandBoulePreset({ engine: handle, store: gbStoreCell as never, presetId: 'ok' })).toBe(false);
    });

    it('should load preset into store and engine when preset and store exist', () => {
        const params = createNeutralPresetParameters();
        vi.mocked(findBuiltinGrandBoulePreset).mockReturnValue({
            id: 'ok',
            name: 'OK',
            description: '',
            parameters: params,
        });

        gbStoreCell.value = {
            config: createDefaultGrandBouleConfig(),
            parameters: createNeutralPresetParameters(),
            pedals: { sustain: 0, unaCorda: false, sostenuto: false },
            midiCalibration: createDefaultMidiCalibration(),
            perNoteOverrides: new Map(),
            morph: createDefaultMorphState(),
            temperament: 0,
        };

        const { handle, setParam } = fakeEngine();

        expect(loadGrandBoulePreset({ engine: handle, store: gbStoreCell as never, presetId: 'ok' })).toBe(true);

        expect(gbStoreCell.set).toHaveBeenCalled();
        expect(setParam).toHaveBeenCalledWith({ name: 'hammer_hardness', value: params.hammerHardness });
        expect(setParam).toHaveBeenCalledWith({ name: 'tone_tilt', value: params.toneTilt });
        expect(setParam).toHaveBeenCalledWith({ name: 'stereo_width', value: params.stereoWidth });
        expect(setParam).toHaveBeenCalledWith({ name: 'velocity_curve', value: params.velocityCurve });
    });
});
