import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createTrack } from '../../../models/Track';
import { prepareRemoveDevice } from '../prepareRemoveDevice';

import type { unloadPlugin } from '#/modules/PluginHost/useCases';
import type { Device, Track } from '../../../models/Track';
import type { getTrackState } from '../../../repositories/track/getTrackState';
import type { mapAllTracks } from '../../../repositories/track/mapAllTracks';
import type { projectTrackToLiveStrip } from '../../projectTrackToLiveStrip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn<typeof getTrackState>(),
    mapAllTracks: vi.fn<typeof mapAllTracks>(),
    applyDeviceChainRuntimeDelta: vi.fn(),
    removeTrackStrip: vi.fn(),
    clearReportedLatency: vi.fn<(deviceId: string) => void>(),
    unloadPlugin: vi.fn<typeof unloadPlugin>(),
    projectTrackToLiveStrip: vi.fn<typeof projectTrackToLiveStrip>(),
}));

/** What the delta reports once its host track left project truth mid-commit. */
const SUPERSEDED_DELTA = {
    acceptance: 'superseded',
    application: 'not-applied',
    reason: 'Track t1 left project truth before its remove-device delta was submitted',
};

/** Device ids whose reported latency this removal dropped. */
function clearedLatencyDeviceIds(): string[] {
    return mocks.clearReportedLatency.mock.calls.map(([deviceId]) => deviceId).sort();
}

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/mapAllTracks', () => ({
    mapAllTracks: mocks.mapAllTracks,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    removeTrackStrip: mocks.removeTrackStrip,
    clearReportedLatency: mocks.clearReportedLatency,
}));

vi.mock('../applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    unloadPlugin: mocks.unloadPlugin,
}));

vi.mock('../../projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
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

/** Test-only commit seam: production invokes these callbacks only through Command. */
function removeDevice(deviceId: string): 'written' | 'missing' | 'conflict' {
    const result = prepareRemoveDevice(deviceId);
    if (typeof result === 'string') {
        return result;
    }
    void result.afterCommit();
    return result.outcome;
}

describe('prepareRemoveDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
        });
        mocks.unloadPlugin.mockResolvedValue(undefined);
    });

    it('removes device from store and engine', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', type: 'reverb' }] } as unknown as Track],
            selectedTrackId: null,
        });

        expect(removeDevice('d1')).toBe('written');

        expect(mocks.mapAllTracks.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.applyDeviceChainRuntimeDelta.mock.invocationCallOrder[0]!
        );
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'remove-device' })
        );
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

    it('defers graph removal, latency cleanup, and external unload until the owning transaction commits', async () => {
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

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred unload result');
        }

        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.clearReportedLatency).not.toHaveBeenCalled();
        await result.afterCommit();
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'remove-device' })
        );
        expect(mocks.clearReportedLatency).toHaveBeenCalledWith('d1');
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
    });

    it('keeps a non-live folder removal project-only across commit reconciliation', async () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [createExternalDevice('external-1', 'instance-1')];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        const result = prepareRemoveDevice('external-1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred removal result');
        }

        mocks.getTrackState.mockReturnValue({ tracks: [{ ...folder, devices: [] }], selectedTrackId: null });
        await expect(result.afterCommit()).resolves.toBeUndefined();
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });
        await expect(result.afterAmbiguousCommit()).resolves.toBeUndefined();

        expect(mocks.mapAllTracks).toHaveBeenCalledOnce();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.clearReportedLatency).not.toHaveBeenCalled();
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
    });

    it('discharges the graph obligation when the delta reports itself superseded', async () => {
        // Deferred finalization is validated against final project authority. A
        // grouped undo of "create bus, add device to it" inverts to "remove the
        // device, then discard the bus", so by the time this runs the host track
        // is gone and the delta reports itself void rather than stale. That is
        // not a failure — but every other obligation of this removal still has
        // to run.
        const track = {
            id: 't1',
            kind: 'audio',
            devices: [createExternalDevice('d1', 'inst1')],
        } as unknown as Track;
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(SUPERSEDED_DELTA);

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred removal result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });

        await expect(result.afterCommit()).resolves.toBeUndefined();

        expect(clearedLatencyDeviceIds()).toEqual(['d1']);
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
    });

    it('discharges the graph obligation on ambiguous reconciliation too', async () => {
        const track = {
            id: 't1',
            kind: 'audio',
            devices: [createExternalDevice('d1', 'inst1')],
        } as unknown as Track;
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(SUPERSEDED_DELTA);

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred removal result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });

        await expect(result.afterAmbiguousCommit()).resolves.toBeUndefined();

        expect(mocks.projectTrackToLiveStrip).not.toHaveBeenCalled();
        expect(clearedLatencyDeviceIds()).toEqual(['d1']);
    });

    it('still fails loudly when a surviving host track rejects the device-chain delta', async () => {
        // The skip above is keyed on the host track leaving project truth. A
        // track that is still there and no longer matches the compiled chain is
        // a genuine mismatch and must keep demanding manual repair.
        const track = {
            id: 't1',
            kind: 'audio',
            devices: [createExternalDevice('d1', 'inst1')],
        } as unknown as Track;
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta does not match the current project topology',
        });

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred removal result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [{ ...track, devices: [] }], selectedTrackId: null });

        await expect(result.afterCommit()).rejects.toThrow('manual repair is required');
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
    });

    it('does not mask a failed graph removal when ambiguous reconciliation retries it', async () => {
        const track = {
            id: 't1',
            kind: 'audio',
            devices: [createExternalDevice('d1', 'inst1')],
        } as unknown as Track;
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.applyDeviceChainRuntimeDelta
            .mockImplementationOnce(() => {
                throw new Error('graph teardown failed');
            })
            .mockReturnValueOnce({ acceptance: 'accepted', application: 'applied' });

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred unload result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [{ ...track, devices: [] }], selectedTrackId: null });

        await expect(result.afterCommit()).rejects.toThrow('graph teardown failed');
        await expect(result.afterAmbiguousCommit()).rejects.toThrow('graph teardown failed');
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledTimes(2);
        expect(mocks.clearReportedLatency).toHaveBeenCalledOnce();
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();
    });

    it.each([
        ['rejected', { acceptance: 'rejected', application: 'not-applied', reason: 'stale graph revision' }],
        [
            'needs-reconcile',
            { acceptance: 'accepted', application: 'needs-reconcile', reason: 'partial graph removal' },
        ],
    ])('preserves an initial %s runtime result after a successful retry', async (_application, initialResult) => {
        const track = {
            id: 't1',
            kind: 'audio',
            devices: [createExternalDevice('d1', 'inst1')],
        } as unknown as Track;
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.applyDeviceChainRuntimeDelta
            .mockReturnValueOnce(initialResult)
            .mockReturnValueOnce({ acceptance: 'accepted', application: 'applied' });

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred unload result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [{ ...track, devices: [] }], selectedTrackId: null });

        await expect(result.afterCommit()).rejects.toThrow(initialResult.reason);
        await expect(result.afterAmbiguousCommit()).rejects.toThrow(initialResult.reason);
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledTimes(2);
        expect(mocks.clearReportedLatency).toHaveBeenCalledOnce();
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();
    });

    it('keeps a failed deferred plugin unload retryable without repeating finalized graph teardown', async () => {
        const track = {
            id: 't1',
            kind: 'audio',
            devices: [createExternalDevice('d1', 'inst1')],
        } as unknown as Track;
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.unloadPlugin.mockRejectedValueOnce(new Error('host teardown failed')).mockResolvedValueOnce(undefined);

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred unload result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [{ ...track, devices: [] }], selectedTrackId: null });

        await expect(result.afterCommit()).rejects.toThrow('host teardown failed');
        await expect(result.afterAmbiguousCommit()).resolves.toBeUndefined();
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.unloadPlugin).toHaveBeenCalledTimes(2);
    });

    it('keeps a failed deferred strip teardown retryable without repeating finalized device removal', async () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [{ id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });
        mocks.removeTrackStrip
            .mockImplementationOnce(() => {
                throw new Error('strip teardown failed');
            })
            .mockImplementationOnce(() => undefined);

        const result = prepareRemoveDevice('toaster-1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred unload result');
        }
        mocks.getTrackState.mockReturnValue({ tracks: [{ ...folder, devices: [] }], selectedTrackId: null });

        await expect(result.afterCommit()).rejects.toThrow('strip teardown failed');
        await expect(result.afterAmbiguousCommit()).resolves.toBeUndefined();
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.removeTrackStrip).toHaveBeenCalledTimes(2);
    });

    it('reprojects a restored external device after an ambiguous rollback without unloading it', async () => {
        const track = {
            id: 't1',
            kind: 'audio',
            devices: [createExternalDevice('d1', 'inst1')],
        } as unknown as Track;
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected deferred unload result');
        }
        await result.afterAmbiguousCommit();

        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 't1',
            activateDormantExternalPlugins: true,
        });
    });

    it('removes the strip after removing the last Toaster from a folder', () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            createExternalDevice(),
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('toaster-1');

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'remove-device' })
        );
        expect(mocks.removeTrackStrip).toHaveBeenCalledWith('folder-1');
        expect(mocks.applyDeviceChainRuntimeDelta.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.removeTrackStrip.mock.invocationCallOrder[0]!
        );
        expect(mocks.unloadPlugin).toHaveBeenCalledTimes(1);
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('instance-1');
    });

    it('drops reported latency for every sibling plugin the strip teardown unloads', async () => {
        // Deactivating the strip tears down BOTH retained external instances even
        // though neither was the removed device. Their registry entries would
        // otherwise survive as phantom compensation on a track with no plugins.
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            createExternalDevice('external-1', 'instance-1'),
            createExternalDevice('external-2', 'instance-2'),
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        const result = prepareRemoveDevice('toaster-1');
        if (typeof result === 'string') {
            throw new TypeError('Expected prepared removal effects');
        }
        await result.afterCommit();

        expect(mocks.removeTrackStrip).toHaveBeenCalledWith('folder-1');
        expect(mocks.unloadPlugin.mock.calls.map(([id]) => id).sort()).toEqual(['instance-1', 'instance-2']);
        expect(clearedLatencyDeviceIds()).toEqual(['external-1', 'external-2']);
    });

    it('keeps reported latency for siblings that stay loaded when the strip survives', () => {
        // The strip stays live (the folder keeps a Toaster), so the sibling plugin
        // is still processing — clearing its latency would under-compensate.
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            createExternalDevice('external-1', 'instance-1'),
            createExternalDevice('external-2', 'instance-2'),
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('external-1');

        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin.mock.calls.map(([id]) => id)).toEqual(['instance-1']);
        expect(clearedLatencyDeviceIds()).toEqual(['external-1']);
    });

    it('keeps a never-live ordinary folder removal out of runtime teardown', () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [createExternalDevice()];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('external-1');

        expect(mocks.mapAllTracks).toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.clearReportedLatency).not.toHaveBeenCalled();
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

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'remove-device' })
        );
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

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'remove-device' })
        );
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
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it('returns missing without truth or runtime cleanup', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [], selectedTrackId: null });

        expect(removeDevice('missing')).toBe('missing');
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
    });

    it('returns missing when the track store itself is absent', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(removeDevice('d1')).toBe('missing');
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
    });

    it('fails closed when a single track owns its id more than once in project truth', () => {
        // A corrupted state where the same track id appears twice would let the
        // removal pick the first occurrence but mutate the wrong record; the
        // owner-count guard rejects it as a conflict before any write.
        const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
        track.devices = [{ id: 'd1', name: 'D', type: 'delay', bypassed: false, parameterValues: {} }];
        mocks.getTrackState.mockReturnValue({ tracks: [track, { ...track }], selectedTrackId: null });

        expect(removeDevice('d1')).toBe('conflict');
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
    });

    it('passes unrelated tracks through the map untouched while editing the owner', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio', devices: [{ id: 'd1', type: 'reverb' }] } as unknown as Track,
                { id: 't2', kind: 'audio', devices: [{ id: 'd2', type: 'eq' }] } as unknown as Track,
            ],
            selectedTrackId: null,
        });

        removeDevice('d1');

        const updater = mocks.mapAllTracks.mock.calls[0]![0] as (track: Partial<Track>) => Partial<Track>;
        const unrelated = { id: 't2', devices: [{ id: 'd2', type: 'eq' }] as unknown as Device[] };
        // The non-owner track is returned by reference, unmutated.
        expect(updater(unrelated)).toBe(unrelated);
    });

    it('skips non-external retained siblings during strip-deactivation unload', () => {
        // Removing the last Toaster deactivates the strip; only external-plugin
        // siblings with live instances are unloaded, builtin siblings are skipped.
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            { id: 'builtin-1', name: 'Builtin', type: 'delay', bypassed: false, parameterValues: {} },
            createExternalDevice('external-1', 'instance-1'),
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });

        removeDevice('toaster-1');

        expect(mocks.removeTrackStrip).toHaveBeenCalledWith('folder-1');
        // Only the external sibling is unloaded; the builtin sibling is not.
        expect(mocks.unloadPlugin.mock.calls.map(([id]) => id)).toEqual(['instance-1']);
    });

    it('reports a post-commit compiled removal failure without logging it away', async () => {
        const folder = createTrack({ id: 'folder-1', name: 'Folder', kind: 'folder' });
        folder.devices = [
            createExternalDevice(),
            { id: 'toaster-1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} },
        ];
        mocks.getTrackState.mockReturnValue({ tracks: [folder], selectedTrackId: null });
        mocks.applyDeviceChainRuntimeDelta.mockImplementationOnce(() => {
            throw new Error('device teardown failed');
        });
        const result = prepareRemoveDevice('toaster-1');
        if (typeof result === 'string') {
            throw new TypeError('Expected prepared removal effects');
        }

        await expect(result.afterCommit()).rejects.toThrow('device teardown failed');
        expect(mocks.mapAllTracks).toHaveBeenCalledOnce();
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it.each([
        ['rejected', { acceptance: 'rejected', application: 'not-applied', reason: 'stale graph revision' }],
        [
            'needs-reconcile',
            { acceptance: 'accepted', application: 'needs-reconcile', reason: 'partial graph removal' },
        ],
    ])('preserves the %s runtime result as a post-commit repair failure', async (_application, runtimeResult) => {
        const track = createTrack({ id: 'audio-1', name: 'Audio', kind: 'audio' });
        track.devices = [{ id: 'd1', name: 'Delay', type: 'delay', bypassed: false, parameterValues: {} }];
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(runtimeResult);

        const result = prepareRemoveDevice('d1');
        if (typeof result === 'string') {
            throw new TypeError('Expected prepared removal effects');
        }

        await expect(result.afterCommit()).rejects.toThrow(runtimeResult.reason);
        expect(mocks.clearReportedLatency).not.toHaveBeenCalled();
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it('permits dormant VCA device and plugin cleanup', () => {
        const track = createTrack({ id: 'vca-1', name: 'VCA', kind: 'audio' });
        Object.defineProperty(track, 'kind', { value: 'vca' });
        track.devices = [createExternalDevice('d1', 'inst1')];
        mocks.getTrackState.mockReturnValue({ tracks: [track], selectedTrackId: null });

        removeDevice('d1');

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'remove-device' })
        );
        expect(mocks.removeTrackStrip).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).toHaveBeenCalledWith('inst1');
        expect(mocks.mapAllTracks).toHaveBeenCalled();
    });
});
