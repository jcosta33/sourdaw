import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack } from '../../../models/Track';
import { removeDevice } from '../removeDevice';

import type { removeDeviceFromStrip } from '#/modules/AudioEngine/useCases';
import type { unloadPlugin } from '#/modules/PluginHost/useCases';
import type { Device, Track } from '../../../models/Track';
import type { getTrackState } from '../../../repositories/track/getTrackState';
import type { mapAllTracks } from '../../../repositories/track/mapAllTracks';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<typeof getTrackState>(),
    mapAllTracks: vi.fn<typeof mapAllTracks>(),
    removeDeviceFromStrip: vi.fn<typeof removeDeviceFromStrip>(),
    removeTrackStrip: vi.fn(),
    unloadPlugin: vi.fn<typeof unloadPlugin>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    removeDeviceFromStrip: mocks.removeDeviceFromStrip,
    removeTrackStrip: mocks.removeTrackStrip,
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    unloadPlugin: mocks.unloadPlugin,
}));

describe('removeDevice', () => {
    beforeEach(() => vi.clearAllMocks());

    it('removes device from store and engine', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'reverb' }] } as unknown as Track],
            selectedTrackId: null,
        });

        removeDevice('d1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('t1', 'd1');
        expect(mocks.mapAllTracks).toHaveBeenCalled();
        const updater = mocks.mapAllTracks.mock.calls[0]![0] as (track: Partial<Track>) => Partial<Track>;
        expect(updater({ devices: [{ id: 'd1' }, { id: 'd2' }] as unknown as Device[] })).toEqual({
            devices: [{ id: 'd2' }],
        });
    });

    it('unloads plugin if it is an external plugin', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    devices: [{ id: 'd1', type: 'external-plugin', externalInstanceId: 'inst1' }],
                } as unknown as Track,
            ],
            selectedTrackId: null,
        });

        removeDevice('d1');

        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
    });

    it('removes the strip after removing the last Toaster from a folder', () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            {
                id: 'external-1',
                name: 'External',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'plugin-1',
                externalInstanceId: 'instance-1',
            },
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('toaster-1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('folder-1', 'toaster-1');
        expect(mocks.removeTrackStrip).toHaveBeenCalledWith('folder-1');
        expect(mocks.removeDeviceFromStrip.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.removeTrackStrip.mock.invocationCallOrder[0]!
        );
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it('retains a live folder strip when another Toaster remains', () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            { id: 'toaster-1', name: 'Toaster 1', type: 'toaster', bypassed: false, parameterValues: {} },
            { id: 'toaster-2', name: 'Toaster 2', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('toaster-1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('folder-1', 'toaster-1');
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
    });

    it('retains a live Toaster folder strip and unloads a removed external device exactly once', () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
            {
                id: 'external-1',
                name: 'External',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'plugin-1',
                externalInstanceId: 'instance-1',
            },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('external-1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('folder-1', 'external-1');
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).toHaveBeenCalledTimes(1);
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('instance-1');
    });

    it('permits dormant VCA device and plugin cleanup', () => {
        const track = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(track, 'kind', { value: 'vca' });
        track.devices = [
            {
                id: 'd1',
                name: 'Legacy plugin',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalInstanceId: 'inst1',
            },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });

        removeDevice('d1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('vca-1', 'd1');
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
        expect(mocks.mapAllTracks).toHaveBeenCalled();
    });
});
