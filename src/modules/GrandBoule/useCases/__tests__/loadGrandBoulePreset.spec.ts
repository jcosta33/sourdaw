import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { createDefaultGrandBouleConfig } from '../../models/GrandBouleConfig';
import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { createDefaultMorphState } from '../../models/GrandBouleMorphState';
import { createNeutralPresetParameters } from '../../models/GrandBoulePreset';
import { findBuiltinGrandBoulePreset } from '../../repositories/findBuiltinGrandBoulePreset';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { loadGrandBoulePreset } from '../loadGrandBoulePreset';

const mocks = vi.hoisted(() => ({
    commit: vi.fn(),
}));

vi.mock('../commitGrandBouleDeviceState', () => ({ commitGrandBouleDeviceState: mocks.commit }));

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
            setCalibration: vi.fn(),
            setSustain: vi.fn(),
            setUnaCorda: vi.fn(),
            setSostenuto: vi.fn(),
            setTemperament: vi.fn(),
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
        mocks.commit.mockClear();
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
        expect(mocks.commit).not.toHaveBeenCalled();
    });

    it('commits the preset voicing to project truth when the caller names the device', () => {
        const params = { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 };
        vi.mocked(findBuiltinGrandBoulePreset).mockReturnValue({
            id: 'grand-boule-bright',
            name: 'Bright Crust',
            description: '',
            parameters: params,
        });

        const morph = createDefaultMorphState();
        gbStoreCell.value = {
            config: createDefaultGrandBouleConfig(),
            parameters: createNeutralPresetParameters(),
            pedals: { sustain: 0, unaCorda: false, sostenuto: false },
            midiCalibration: createDefaultMidiCalibration(),
            perNoteOverrides: new Map(),
            morph,
            temperament: 3,
        };

        const { handle } = fakeEngine();

        expect(
            loadGrandBoulePreset({
                deviceId: 'grand-1',
                engine: handle,
                store: gbStoreCell as never,
                presetId: 'grand-boule-bright',
            })
        ).toBe(true);

        expect(mocks.commit).toHaveBeenCalledTimes(1);
        expect(mocks.commit).toHaveBeenCalledWith('grand-1', { morph, temperament: 3, parameters: params });
    });
});
