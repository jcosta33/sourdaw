import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addDeviceToStrip } from '#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip';
import { removeDeviceFromStrip } from '#/modules/AudioEngine/useCases/deviceControls/removeDeviceFromStrip';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls/updateDeviceParam';

import { type SoundPreset } from '../../../models/SoundPreset';
import { type Track } from '../../../models/Track';
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

vi.mock('#/modules/AudioEngine/useCases/deviceControls/addDeviceToStrip', () => ({
    addDeviceToStrip: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/deviceControls/updateDeviceParam', () => ({
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/deviceControls/removeDeviceFromStrip', () => ({
    removeDeviceFromStrip: vi.fn(),
}));

vi.mock('#/modules/Plugin/useCases', () => ({
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
        const track = {
            id: 't1',
            devices: [
                {
                    id: 'old-dev',
                    name: 'Old',
                    type: 'delay',
                    bypassed: false,
                    parameterValues: {},
                },
            ],
        } as Track;

        vi.mocked(getTrackById).mockReturnValue(track);
        vi.mocked(addDevice).mockReturnValue({
            id: 'new-fx',
            name: 'Delay',
            type: 'delay',
            bypassed: false,
            parameterValues: { mix: 0.5 },
        });

        loadPresetToTrack('t1', basePreset([{ type: 'delay', name: 'Delay', parameterValues: { mix: 0.5 } }]));

        expect(removeDeviceFromStrip).toHaveBeenCalledWith('t1', 'old-dev');
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const clearDevices = vi.mocked(updateTrack).mock.calls[0]?.[1];
        expect(clearDevices?.(track)).toEqual({ ...track, devices: [] });
    });

    it('should add effect devices without stripping when track is missing', () => {
        vi.mocked(getTrackById).mockReturnValue(undefined);
        vi.mocked(addDevice).mockReturnValue({
            id: 'fx-1',
            name: 'Reverb',
            type: 'reverb',
            bypassed: false,
            parameterValues: { size: 0.2 },
        });

        loadPresetToTrack('ghost', basePreset([{ type: 'reverb', name: 'Reverb', parameterValues: { size: 0.2 } }]));

        expect(removeDeviceFromStrip).not.toHaveBeenCalled();
        expect(addDevice).toHaveBeenCalledWith('ghost', 'Reverb');
        expect(setDeviceParameter).toHaveBeenCalledWith('fx-1', 'size', 0.2);
        expect(updateDeviceParam).toHaveBeenCalledWith('ghost', 'fx-1', 'size', 0.2);
    });

    it('should attach instrument devices via updateTrack and audio strip', () => {
        vi.mocked(getTrackById).mockReturnValue(undefined);

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
        vi.mocked(getTrackById).mockReturnValue(undefined);

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
});
