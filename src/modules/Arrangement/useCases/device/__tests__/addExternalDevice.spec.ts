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
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'audio-1', kind: 'audio', devices: [] }] });
    });

    it('persists an external plugin on an ordinary folder without starting runtime work', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'folder-1', kind: 'folder', devices: [] }] });

        const device = addExternalDevice('folder-1', 'plugin-1', 'Plugin');

        expect(device).toMatchObject({ type: 'external-plugin' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('folder-1', expect.any(Function));
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
    });

    it('adds an external plugin to an already-live Toaster folder', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'folder-1', kind: 'folder', devices: [{ id: 'toaster-1', type: 'toaster' }] }],
        });

        const device = addExternalDevice('folder-1', 'plugin-1', 'Plugin');

        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith(
            'folder-1',
            device?.id,
            'external-plugin',
            device?.externalInstanceId
        );
        expect(mocks.loadPlugin).toHaveBeenCalledWith('plugin-1', device?.externalInstanceId);
    });

    it('preserves ordinary external plugin creation and runtime loading', () => {
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
            device?.externalInstanceId
        );
        expect(mocks.loadPlugin).toHaveBeenCalledWith('plugin-1', device?.externalInstanceId);
    });

    it('rejects a dormant VCA before ID, instance, project, engine, or plugin work', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca', devices: [] }] });

        expect(addExternalDevice('vca-1', 'plugin-1', 'Plugin')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
    });
});
