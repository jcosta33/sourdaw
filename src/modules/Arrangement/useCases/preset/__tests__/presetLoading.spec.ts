import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addDeviceToStrip, removeDeviceFromStrip, updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { type SoundPreset } from '../../../models/SoundPreset';
import { normalizeTrack, type Track } from '../../../models/Track';
import { getTrackById } from '../../../repositories/track/getTrackById';
import { updateTrack } from '../../../repositories/track/updateTrack';
import { addDevice } from '../../device/addDevice';
import { setDeviceParameter } from '../../device/setDeviceParameter/setDeviceParameter';
import { loadPresetToTrack } from '../presetLoading';

const mocks = vi.hoisted(() => ({
    compileFaustDSP: vi.fn(),
    createFaustNode: vi.fn(),
    isFaustModule: vi.fn((moduleId: string) => moduleId.startsWith('faust-')),
    logger: { error: vi.fn() },
    notifyUser: vi.fn(),
    registerFaustDSP: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackById', () => ({
    getTrackById: vi.fn(),
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../../device/addDevice', () => ({
    addDevice: vi.fn(),
}));

vi.mock('../../device/setDeviceParameter/setDeviceParameter', () => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return { ...actual, addDeviceToStrip: vi.fn(), updateDeviceParam: vi.fn(), removeDeviceFromStrip: vi.fn() };
});

vi.mock('#/modules/PluginHost/useCases', () => ({
    compileFaustDSP: mocks.compileFaustDSP,
    createFaustNode: mocks.createFaustNode,
    isFaustModule: mocks.isFaustModule,
    registerFaustDSP: mocks.registerFaustDSP,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

function basePreset(devices: SoundPreset['devices']): SoundPreset {
    return {
        id: 'p1',
        name: 'Test Preset',
        category: 'keys',
        description: '',
        trackKind: 'midi',
        devices,
        tags: [],
        author: 'test',
        isFactory: true,
    };
}

function makeTrack(id: string, deviceId = 'old-dev'): Track {
    return normalizeTrack({
        id,
        name: id,
        kind: 'audio',
        devices: [
            {
                id: deviceId,
                name: 'Old',
                type: 'delay',
                bypassed: false,
                parameterValues: {},
            },
        ],
    });
}

function setRuntimeKind(track: Track, kind: string): Track {
    Object.defineProperty(track, 'kind', { configurable: true, enumerable: true, value: kind });
    return track;
}

describe('loadPresetToTrack', () => {
    beforeEach(() => {
        vi.mocked(getTrackById).mockReset();
        vi.mocked(updateTrack).mockReset();
        vi.mocked(addDevice).mockReset();
        vi.mocked(setDeviceParameter).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
        vi.mocked(updateDeviceParam).mockReset();
        vi.mocked(removeDeviceFromStrip).mockReset();
        mocks.compileFaustDSP.mockReset();
        mocks.logger.error.mockReset();
        mocks.notifyUser.mockReset();
    });

    it('should strip existing devices before loading when track exists', () => {
        const track = makeTrack('t1');

        vi.mocked(getTrackById).mockReturnValue(track);
        vi.mocked(addDevice).mockReturnValue({
            id: 'new-fx',
            name: 'Delay',
            type: 'delay',
            bypassed: false,
            parameterValues: { mix: 0.5 },
        });

        const didWrite = loadPresetToTrack(
            't1',
            basePreset([{ type: 'delay', name: 'Delay', parameterValues: { mix: 0.5 } }])
        );

        expect(didWrite).toBe(true);
        expect(removeDeviceFromStrip).toHaveBeenCalledWith('t1', 'old-dev');
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const clearDevices = vi.mocked(updateTrack).mock.calls[0]?.[1];
        expect(clearDevices?.(track)).toEqual({ ...track, devices: [] });
    });

    it('rejects a missing target before any effect', () => {
        vi.mocked(getTrackById).mockReturnValue(undefined);
        vi.mocked(addDevice).mockReturnValue({
            id: 'fx-1',
            name: 'Reverb',
            type: 'reverb',
            bypassed: false,
            parameterValues: { size: 0.2 },
        });

        const didWrite = loadPresetToTrack(
            'ghost',
            basePreset([{ type: 'reverb', name: 'Reverb', parameterValues: { size: 0.2 } }])
        );

        expect(didWrite).toBe(false);
        expect(removeDeviceFromStrip).not.toHaveBeenCalled();
        expect(addDevice).not.toHaveBeenCalled();
        expect(setDeviceParameter).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('should attach instrument devices via updateTrack and audio strip', () => {
        vi.mocked(getTrackById).mockReturnValue(makeTrack('t2'));

        loadPresetToTrack(
            't2',
            basePreset([{ type: 'builtin-synth', name: 'Poly', parameterValues: { cutoff: 0.4 } }])
        );

        expect(updateTrack).toHaveBeenCalled();
        expect(addDeviceToStrip).toHaveBeenCalled();
        expect(updateDeviceParam).toHaveBeenCalledWith('t2', expect.any(String), 'cutoff', 0.4);
    });

    it('should notify when Faust instrument compilation fails', async () => {
        const failure = new Error('compile failed');
        mocks.compileFaustDSP.mockRejectedValueOnce(failure);
        vi.mocked(getTrackById).mockReturnValue(makeTrack('t3'));

        loadPresetToTrack(
            't3',
            basePreset([{ type: 'faust-synth', name: 'Faust Synth', parameterValues: { gain: 0.8 } }])
        );
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });

        expect(mocks.compileFaustDSP).toHaveBeenCalledWith('faust-synth');
        const loggedError: unknown = mocks.logger.error.mock.calls[0]?.[0];
        expect(loggedError).toBeInstanceOf(Error);
        if (!(loggedError instanceof Error)) {
            throw new Error('Expected Faust compilation failure to be logged');
        }
        expect(loggedError.message).toBe('Faust compilation failed for faust-synth');
        expect(loggedError.cause).toBe(failure);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to compile Faust device: Faust Synth', 'error');
    });

    it('rejects a VCA target before removal, allocation, mutation, compile, runtime, or notification', async () => {
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        vi.mocked(getTrackById).mockReturnValue(setRuntimeKind(makeTrack('vca-1'), 'vca'));

        const didWrite = loadPresetToTrack(
            'vca-1',
            basePreset([{ type: 'faust-synth', name: 'Forbidden', parameterValues: { gain: 0.8 } }])
        );
        await Promise.resolve();

        expect(didWrite).toBe(false);
        expect(removeDeviceFromStrip).not.toHaveBeenCalled();
        expect(randomUuid).not.toHaveBeenCalled();
        expect(updateTrack).not.toHaveBeenCalled();
        expect(addDevice).not.toHaveBeenCalled();
        expect(setDeviceParameter).not.toHaveBeenCalled();
        expect(mocks.compileFaustDSP).not.toHaveBeenCalled();
        expect(addDeviceToStrip).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('leaves an effect preset value to setDeviceParameter instead of writing past it', () => {
        vi.mocked(getTrackById).mockReturnValue(makeTrack('t5'));
        vi.mocked(addDevice).mockReturnValue({
            id: 'ov-1',
            name: 'Dutch Oven',
            type: 'dutch-oven',
            bypassed: false,
            parameterValues: {},
        });

        loadPresetToTrack(
            't5',
            basePreset([{ type: 'dutch-oven', name: 'Dutch Oven', parameterValues: { mix: 4.2 } }])
        );

        // `setDeviceParameter` clamps and pushes the clamped value to the
        // engine itself. A second, raw `updateDeviceParam` here wrote after it
        // and therefore won, handing the DSP the 4.2 the store had refused.
        expect(setDeviceParameter).toHaveBeenCalledWith('ov-1', 'mix', 4.2);
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('holds an instrument preset value to the declared range before it lands in the track', () => {
        vi.mocked(getTrackById).mockReturnValue(makeTrack('t6'));

        // `fermenter` declares `filterCutoff` over 20..20000 Hz. An instrument
        // preset is written straight into the track by updateTrack, so nothing
        // upstream holds it to the descriptor, and the store row is what the
        // project saves and reloads.
        loadPresetToTrack(
            't6',
            basePreset([{ type: 'fermenter', name: 'Lead', parameterValues: { filterCutoff: 99000 } }])
        );

        // Call 0 clears the strip; call 1 appends the preset's instrument.
        const appendDevice = vi.mocked(updateTrack).mock.calls[1]?.[1];
        const appended = appendDevice?.({ ...makeTrack('t6'), devices: [] });
        expect(appended?.devices[0]?.parameterValues).toEqual({ filterCutoff: 20000 });
        expect(updateDeviceParam).toHaveBeenCalledWith('t6', expect.any(String), 'filterCutoff', 20000);
    });

    it('skips parameter wiring for an effect device that fails to attach', () => {
        vi.mocked(getTrackById).mockReturnValue(makeTrack('t4'));
        // addDevice returns null (e.g. ineligible target) -> attachEffectDevice
        // bails before setting any parameter values.
        vi.mocked(addDevice).mockReturnValue(null);

        loadPresetToTrack('t4', basePreset([{ type: 'delay', name: 'Delay', parameterValues: { mix: 0.5 } }]));

        expect(addDevice).toHaveBeenCalledWith('t4', 'Delay');
        expect(setDeviceParameter).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });
});
