import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { createDefaultGrandBouleConfig } from '../../models/GrandBouleConfig';
import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { createDefaultMorphState } from '../../models/GrandBouleMorphState';
import { createNeutralPresetParameters } from '../../models/GrandBoulePreset';
import { findBuiltinGrandBoulePreset } from '../../repositories/findBuiltinGrandBoulePreset';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';
import { loadGrandBoulePreset } from '../loadGrandBoulePreset';

/**
 * The load owns the four voicing leaves only. The session store is a mirror
 * another peer's device-state action can leave behind, so the untouched morph
 * and temperament leaves must come from the project chunk — a store stale
 * against the chunk would otherwise revert the chunk's tuning on a preset pick.
 */

const mocks = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: undefined };
    return {
        executeAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
        executeUserAppAction: vi.fn((_action: unknown) => Promise.resolve(undefined)),
        trackStore,
        reconcile: vi.fn(),
    };
});

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: mocks.executeUserAppAction,
}));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('../reconcileGrandBouleDeviceStateFromProject', () => ({
    reconcileGrandBouleDeviceStateFromProject: mocks.reconcile,
}));

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

function projectChunk(data: Record<string, unknown>): void {
    mocks.trackStore.value = {
        tracks: [
            {
                devices: [
                    { id: 'grand-1', type: 'grand-boule', parameterValues: {}, deviceState: { version: 1, data } },
                ],
            },
        ],
    };
}

function dispatchedAfter(): Record<string, unknown> | undefined {
    const [action] = mocks.executeAppAction.mock.calls.at(-1) ?? [];
    if (action === undefined) {
        return undefined;
    }
    return (action as { payload: { after: { data: Record<string, unknown> } } }).payload.after.data;
}

describe('loadGrandBoulePreset', () => {
    beforeEach(() => {
        gbStoreCell.value = null;
        gbStoreCell.set.mockClear();
        mocks.executeAppAction.mockClear();
        mocks.reconcile.mockClear();
        mocks.trackStore.value = undefined;
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
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    // A store stale against the chunk must not revert the chunk's untouched
    // leaves: the load sources morph and temperament from the fresh chunk and
    // writes only the voicing it owns, so the chunk's tuning survives a pick.
    it('commits the preset voicing with the untouched leaves the project chunk holds', () => {
        const params = { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 };
        vi.mocked(findBuiltinGrandBoulePreset).mockReturnValue({
            id: 'grand-boule-bright',
            name: 'Bright Crust',
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
            temperament: 3,
        };
        projectChunk({
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: -0.2,
            enabled: true,
            temperament: 1,
            hammerHardness: 0.3,
            velocityCurve: 1.25,
            stereoWidth: 0.8,
            toneTilt: -0.4,
        });

        const { handle } = fakeEngine();

        expect(
            loadGrandBoulePreset({
                deviceId: 'grand-1',
                engine: handle,
                store: gbStoreCell as never,
                presetId: 'grand-boule-bright',
            })
        ).toBe(true);

        expect(dispatchedAfter()).toEqual({
            modelA: 'mellow-grand',
            modelB: 'singing-grand',
            morphPosition: 0.4,
            layerBalance: -0.2,
            enabled: true,
            temperament: 1,
            hammerHardness: 0.4,
            velocityCurve: 0.85,
            stereoWidth: 0.7,
            toneTilt: 0.35,
        });
    });
});
