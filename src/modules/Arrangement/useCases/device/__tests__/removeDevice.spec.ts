import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack } from '../../../models/Track';
import { removeDevice } from '../removeDevice';

import type { removeDeviceFromStrip } from '#/modules/AudioEngine/useCases';
import type { unloadPlugin } from '#/modules/PluginHost/useCases';
import type { Device, Track } from '../../../models/Track';
import type { getTrackState } from '../../../repositories/track/getTrackState';
import type { mapAllTracks } from '../../../repositories/track/mapAllTracks';

const mocks = vi.hoisted(() => ({
    logger: { warn: vi.fn() },
    getTrackState: vi.fn<typeof getTrackState>(),
    mapAllTracks: vi.fn<typeof mapAllTracks>(),
    removeDeviceFromStrip: vi.fn<typeof removeDeviceFromStrip>(),
    removeTrackStrip: vi.fn(),
    unloadPlugin: vi.fn<typeof unloadPlugin>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
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

function createExternalDevice(id = 'external-1', instanceId = 'instance-1'): Device {
    return {
        id,
        name: 'External',
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalPluginId: 'plugin-1',
        externalInstanceId: instanceId,
    };
}

describe('removeDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.unloadPlugin.mockResolvedValue(undefined);
    });

    it('removes device from store and engine', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'reverb' }] } as unknown as Track],
            selectedTrackId: null,
        });

        expect(removeDevice('d1')).toBe('written');

        expect(mocks.mapAllTracks.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.removeDeviceFromStrip.mock.invocationCallOrder[0]!
        );
        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('t1', 'd1');
        expect(mocks.mapAllTracks).toHaveBeenCalled();
        const updater = mocks.mapAllTracks.mock.calls[0]![0] as (track: Partial<Track>) => Partial<Track>;
        expect(updater({ id: 't1', devices: [{ id: 'd1' }, { id: 'd2' }] as unknown as Device[] })).toEqual({
            id: 't1',
            devices: [{ id: 'd2' }],
        });
    });

    it('unloads plugin if it is an external plugin', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    kind: 'audio',
                    devices: [createExternalDevice('d1', 'inst1')],
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
            createExternalDevice(),
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('toaster-1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('folder-1', 'toaster-1');
        expect(mocks.removeTrackStrip).toHaveBeenCalledWith('folder-1');
        expect(mocks.removeDeviceFromStrip.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.removeTrackStrip.mock.invocationCallOrder[0]!
        );
        expect(mocks.unloadPlugin).toHaveBeenCalledTimes(1);
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('instance-1');
    });

    it('does not unload a removed external plugin from a never-live ordinary folder', () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [createExternalDevice()];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('external-1');

        expect(mocks.mapAllTracks).toHaveBeenCalled();
        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('folder-1', 'external-1');
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
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
            createExternalDevice(),
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('external-1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('folder-1', 'external-1');
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).toHaveBeenCalledTimes(1);
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('instance-1');
    });

    it('fails closed for duplicate device occurrences before truth or runtime cleanup', () => {
        const first = createTrack({ id: 'audio-1', name: 'First', kind: 'audio' });
        const second = createTrack({ id: 'audio-2', name: 'Second', kind: 'audio' });
        first.devices = [{ id: 'duplicate', name: 'First', type: 'delay', bypassed: false, parameterValues: {} }];
        second.devices = [{ id: 'duplicate', name: 'Second', type: 'delay', bypassed: false, parameterValues: {} }];
        mocks.getTrackState.mockReturnValue({ tracks: [first, second], selectedTrackId: null });

        expect(removeDevice('duplicate')).toBe('conflict');

        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.removeDeviceFromStrip).not.toHaveBeenCalled();
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it('returns missing without truth or runtime cleanup', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });

        expect(removeDevice('missing')).toBe('missing');
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.removeDeviceFromStrip).not.toHaveBeenCalled();
    });

    it('commits truth before independently reporting device, strip, and host cleanup failures', async () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            createExternalDevice(),
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });
        mocks.removeDeviceFromStrip.mockImplementationOnce(() => {
            throw new Error('device teardown failed');
        });
        mocks.removeTrackStrip.mockImplementationOnce(() => {
            throw new Error('strip teardown failed');
        });
        mocks.unloadPlugin.mockRejectedValueOnce(new Error('host teardown failed'));

        expect(() => removeDevice('toaster-1')).not.toThrow();

        expect(mocks.mapAllTracks.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.removeDeviceFromStrip.mock.invocationCallOrder[0]!
        );
        expect(mocks.removeTrackStrip).toHaveBeenCalledWith('folder-1');
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('instance-1');
        await vi.waitFor(() => expect(mocks.logger.warn).toHaveBeenCalledTimes(3));
    });

    it('permits dormant VCA device and plugin cleanup', () => {
        const track = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(track, 'kind', { value: 'vca' });
        track.devices = [createExternalDevice('d1', 'inst1')];
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });

        removeDevice('d1');

        expect(mocks.removeDeviceFromStrip).toHaveBeenCalledWith('vca-1', 'd1');
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
        expect(mocks.mapAllTracks).toHaveBeenCalled();
    });
});
