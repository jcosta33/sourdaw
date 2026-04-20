import { describe, it, expect, vi, beforeEach } from 'vitest';

import { addDevice } from '../addDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    getPlatformPlugins: vi.fn(),
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
    compileFaustDSP: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('../../getPlatformPlugins', () => ({
    getPlatformPlugins: mocks.getPlatformPlugins,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    addDeviceToStrip: mocks.addDeviceToStrip,
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Plugin/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    compileFaustDSP: mocks.compileFaustDSP,
}));

describe('addDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [] });
        mocks.getPlatformPlugins.mockReturnValue([]);
    });

    it('adds a generic device if plugin is not found', () => {
        const result = addDevice('t1', 'CustomEffect');

        expect(result).toMatchObject({
            name: 'CustomEffect',
            type: 'CustomEffect',
            bypassed: false,
        });
        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
    });

    it('adds a registered plugin and notifies engine', () => {
        const mockPlugin = {
            id: 'p1',
            name: 'Reverb',
            parameters: [{ id: 'wet', value: 0.5 }],
        };
        mocks.getPlatformPlugins.mockReturnValue([mockPlugin]);

        const result = addDevice('t1', 'Reverb');

        expect(result).toMatchObject({
            name: 'Reverb',
            type: 'p1',
            parameterValues: { wet: 0.5 },
        });
        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith('t1', result?.id, 'p1');
        expect(mocks.updateDeviceParam).toHaveBeenCalledWith('t1', result?.id, 'wet', 0.5);
    });

    it('compiles Faust DSP if it starts with faust-', async () => {
        const mockPlugin = {
            id: 'faust-synth',
            name: 'Faust Synth',
            parameters: [],
        };
        mocks.getPlatformPlugins.mockReturnValue([mockPlugin]);

        addDevice('t1', 'faust-synth');

        await vi.waitFor(() => {
            expect(mocks.compileFaustDSP).toHaveBeenCalledWith('faust-synth');
        });
    });
});
