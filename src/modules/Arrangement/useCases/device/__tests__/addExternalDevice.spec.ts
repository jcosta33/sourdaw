import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addExternalDevice } from '../addExternalDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    addDeviceToStrip: vi.fn(),
    loadPlugin: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    addDeviceToStrip: mocks.addDeviceToStrip,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    loadPlugin: mocks.loadPlugin,
}));

describe('addExternalDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'audio-1', kind: 'audio' }] });
    });

    it('hands the complete external identity to the engine-owned lifecycle', () => {
        const device = addExternalDevice('audio-1', 'plugin-1', 'Plugin');

        expect(device).toMatchObject({
            name: 'Plugin',
            type: 'external-plugin',
            externalPluginId: 'plugin-1',
        });
        expect(mocks.updateTrack).toHaveBeenCalledWith('audio-1', expect.any(Function));
        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith(
            'audio-1',
            device?.id,
            'external-plugin',
            device?.externalInstanceId,
            'plugin-1'
        );
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
    });

    it('rejects a dormant VCA before ID, instance, project, engine, or plugin work', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca' }] });

        expect(addExternalDevice('vca-1', 'plugin-1', 'Plugin')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
    });
});
