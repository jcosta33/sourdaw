import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { loadPresetToTrack } from './presetLoading';
import { type Logger } from '#/helpers/Logger/Logger';
import { type SoundPreset } from '../../models/SoundPreset';
import { type Track } from '../../models/Track';
import { getTrackById } from '../../repositories/track/getTrackById';
import { updateTrack } from '../../repositories/track/updateTrack';
import { addDevice } from '../device/addDevice';
import { setDeviceParameter } from '../device/setDeviceParameter';
import { addDeviceToStrip, updateDeviceParam, removeDeviceFromStrip } from '#/modules/AudioEngine/useCases/deviceControls';

vi.mock('../../repositories/track/getTrackById', () => ({
    getTrackById: vi.fn(),
}));

vi.mock('../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

vi.mock('../device/addDevice', () => ({
    addDevice: vi.fn(),
}));

vi.mock('../device/setDeviceParameter', () => ({
    setDeviceParameter: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/deviceControls', () => ({
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    removeDeviceFromStrip: vi.fn(),
}));

const basePreset = (devices: SoundPreset['devices']): SoundPreset => ({
    id: 'p1',
    name: 'Test Preset',
    category: 'keys',
    description: '',
    trackKind: 'midi',
    devices,
    tags: [],
    author: 'test',
    isFactory: true,
});

describe('loadPresetToTrack', () => {
    beforeEach(() => {
        vi.mocked(getTrackById).mockReset();
        vi.mocked(updateTrack).mockReset();
        vi.mocked(addDevice).mockReset();
        vi.mocked(setDeviceParameter).mockReset();
        vi.mocked(addDeviceToStrip).mockReset();
        vi.mocked(updateDeviceParam).mockReset();
        vi.mocked(removeDeviceFromStrip).mockReset();
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

        const logger = createMock<Logger>();
        injectDependencies(loadPresetToTrack, { logger });

        loadPresetToTrack(
            't1',
            basePreset([{ type: 'delay', name: 'Delay', parameterValues: { mix: 0.5 } }])
        );

        expect(removeDeviceFromStrip).toHaveBeenCalledWith('t1', 'old-dev');
        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
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

        const logger = createMock<Logger>();
        injectDependencies(loadPresetToTrack, { logger });

        loadPresetToTrack(
            'ghost',
            basePreset([{ type: 'reverb', name: 'Reverb', parameterValues: { size: 0.2 } }])
        );

        expect(removeDeviceFromStrip).not.toHaveBeenCalled();
        expect(addDevice).toHaveBeenCalledWith('ghost', 'Reverb');
        expect(setDeviceParameter).toHaveBeenCalledWith('fx-1', 'size', 0.2);
        expect(updateDeviceParam).toHaveBeenCalledWith('ghost', 'fx-1', 'size', 0.2);
    });

    it('should attach instrument devices via updateTrack and audio strip', () => {
        vi.mocked(getTrackById).mockReturnValue(undefined);

        const logger = createMock<Logger>();
        injectDependencies(loadPresetToTrack, { logger });

        loadPresetToTrack(
            't2',
            basePreset([{ type: 'builtin-synth', name: 'Poly', parameterValues: { cutoff: 0.4 } }])
        );

        expect(updateTrack).toHaveBeenCalled();
        expect(addDeviceToStrip).toHaveBeenCalled();
        expect(updateDeviceParam).toHaveBeenCalledWith('t2', expect.any(String), 'cutoff', 0.4);
    });
});
