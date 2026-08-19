import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addExternalDevice } from '../addExternalDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    findSupportedPlugin: vi.fn(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    findSupportedPlugin: mocks.findSupportedPlugin,
}));

describe('addExternalDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'audio-1', kind: 'audio', devices: [] }] });
        mocks.findSupportedPlugin.mockReturnValue({ id: 'plugin-1', format: 'clap' });
    });

    it('only writes project truth for an ordinary folder', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'folder-1', kind: 'folder', devices: [] }] });

        const device = addExternalDevice('folder-1', 'plugin-1', 'Plugin');

        expect(device).toMatchObject({ type: 'external-plugin' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('folder-1', expect.any(Function));
    });

    it('keeps a live Toaster folder project-only until the Command handler commits', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'folder-1', kind: 'folder', devices: [{ id: 'toaster-1', type: 'toaster' }] }],
        });

        expect(addExternalDevice('folder-1', 'plugin-1', 'Plugin')).toMatchObject({ type: 'external-plugin' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('folder-1', expect.any(Function));
    });

    it('creates ordinary external plugin project truth', () => {
        const device = addExternalDevice('audio-1', 'plugin-1', 'Plugin');

        expect(device).toMatchObject({
            name: 'Plugin',
            type: 'external-plugin',
            externalPluginId: 'plugin-1',
        });
        expect(mocks.updateTrack).toHaveBeenCalledWith('audio-1', expect.any(Function));
    });

    it('generates distinct native instance ids for plugins added in the same millisecond', () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(123);

        const first = addExternalDevice('audio-1', 'plugin-1', 'Plugin');
        const second = addExternalDevice('audio-1', 'plugin-1', 'Plugin');

        expect(first?.externalInstanceId).not.toBe(second?.externalInstanceId);
        now.mockRestore();
    });

    it('rejects duplicate track identity before truth, engine, or host work', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 'duplicate', kind: 'audio', devices: [] },
                { id: 'duplicate', kind: 'audio', devices: [] },
            ],
        });

        expect(addExternalDevice('duplicate', 'plugin-1', 'Plugin')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects a dormant VCA before ID, instance, project, engine, or plugin work', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca', devices: [] }] });

        expect(addExternalDevice('vca-1', 'plugin-1', 'Plugin')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('returns null when there is no track state (cleared/absent project)', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(addExternalDevice('audio-1', 'plugin-1', 'Plugin')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });

    it('rejects an unsupported plugin id before project or runtime work', () => {
        mocks.findSupportedPlugin.mockReturnValue(undefined);

        expect(addExternalDevice('audio-1', 'unsupported-vst', 'Unsupported VST')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
    });
});
