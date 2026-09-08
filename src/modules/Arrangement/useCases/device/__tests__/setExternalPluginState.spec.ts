import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Track } from '../../../models/Track';
import { setExternalPluginState } from '../setExternalPluginState';

const mocks = vi.hoisted(() => ({
    getTrackState:
        vi.fn<() => { tracks: { id: string; devices: { id: string; externalInstanceId?: string }[] }[] } | null>(),
    mapAllTracks: vi.fn<(mapper: (track: Track) => Track) => void>(),
    restorePluginState: vi.fn<(instanceId: string, stateChunk: string) => Promise<void>>(),
    hasUnresolvedExternalPluginRestoreFailure: vi.fn<(instanceId: string) => boolean>(),
    clearExternalPluginRestoreFailure: vi.fn<(instanceId: string) => void>(),
}));

vi.mock('../../../repositories/track/getTrackState', () => ({ getTrackState: mocks.getTrackState }));
vi.mock('../../../repositories/track/mapAllTracks', () => ({ mapAllTracks: mocks.mapAllTracks }));
vi.mock('#/modules/PluginHost/useCases', () => ({
    restorePluginState: mocks.restorePluginState,
    hasUnresolvedExternalPluginRestoreFailure: mocks.hasUnresolvedExternalPluginRestoreFailure,
    clearExternalPluginRestoreFailure: mocks.clearExternalPluginRestoreFailure,
}));

function deviceOnly(id: string, extra: Partial<Track['devices'][number]> = {}): Track['devices'][number] {
    return { id, name: id, type: 'external-plugin', bypassed: false, parameterValues: {}, ...extra };
}

describe('setExternalPluginState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.restorePluginState.mockResolvedValue(undefined);
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(false);
    });

    it('stamps the chunk onto the matching device and reports a write', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] });

        const result = setExternalPluginState({ intent: 'replacement', deviceId: 'd1', stateChunk: 'Y2h1bms=' });

        expect(result.didWrite).toBe(true);
        expect(result.pushReplacementToHost).toBeUndefined();
        expect(mocks.mapAllTracks).toHaveBeenCalledTimes(1);

        const mapper = mocks.mapAllTracks.mock.calls[0]![0];
        const mapped = mapper({ devices: [deviceOnly('d1'), deviceOnly('d2')] } as unknown as Track);
        expect(mapped.devices[0]!.externalStateChunk).toBe('Y2h1bms=');
        expect(mapped.devices[1]!.externalStateChunk).toBeUndefined();
    });

    it('captures only against the exact external instance and original chunk witness', () => {
        const device = deviceOnly('d1', { externalInstanceId: 'inst-1', externalStateChunk: 'original' });
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [device] }] });

        const result = setExternalPluginState({
            intent: 'capture',
            deviceId: 'd1',
            stateChunk: 'captured',
            expectedInstanceId: 'inst-1',
            expectedStateChunk: 'original',
        });

        expect(result).toEqual({ didWrite: true });
        const mapper = mocks.mapAllTracks.mock.calls[0]![0];
        expect(mapper({ devices: [device] } as unknown as Track).devices[0]!.externalStateChunk).toBe('captured');
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    it.each([
        ['wrong type', deviceOnly('d1', { type: 'compressor', externalInstanceId: 'inst-1' }), 'inst-1', null],
        ['wrong instance', deviceOnly('d1', { externalInstanceId: 'inst-2' }), 'inst-1', null],
        [
            'wrong original chunk',
            deviceOnly('d1', { externalInstanceId: 'inst-1', externalStateChunk: 'peer' }),
            'inst-1',
            'original',
        ],
    ])('refuses capture for a %s', (_case, device, expectedInstanceId, expectedStateChunk) => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [device] }] });

        const result = setExternalPluginState({
            intent: 'capture',
            deviceId: 'd1',
            stateChunk: 'captured',
            expectedInstanceId,
            expectedStateChunk,
        });

        expect(result).toEqual({ didWrite: false });
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
    });

    it('refuses capture while a restore failure stands and never turns capture into replacement', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [deviceOnly('d1', { externalInstanceId: 'inst-1' })] }],
        });
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(true);

        const result = setExternalPluginState({
            intent: 'capture',
            deviceId: 'd1',
            stateChunk: 'defaults',
            expectedInstanceId: 'inst-1',
            expectedStateChunk: null,
        });

        expect(result).toEqual({ didWrite: false });
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    // A rejected restore left the host holding its defaults: the replacement is
    // only authoritative once the host received it, so the write carries a
    // post-commit push, and the failed-restore marker clears only after the
    // host accepted the chunk.
    it('pushes the replacement to a marked instance and clears the marker after the host accepts it', async () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', externalInstanceId: 'inst-1' }] }],
        });
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(true);

        const result = setExternalPluginState({ intent: 'replacement', deviceId: 'd1', stateChunk: 'Y2h1bms=' });

        expect(result.didWrite).toBe(true);
        expect(result.pushReplacementToHost).toBeDefined();
        // The push runs after the owning transaction commits — the write alone
        // neither pushes nor clears.
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();

        await result.pushReplacementToHost?.();

        expect(mocks.restorePluginState).toHaveBeenCalledExactlyOnceWith('inst-1', 'Y2h1bms=');
        expect(mocks.clearExternalPluginRestoreFailure).toHaveBeenCalledExactlyOnceWith('inst-1');
    });

    it('keeps the marker when the host rejects the replacement push', async () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', externalInstanceId: 'inst-1' }] }],
        });
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(true);
        mocks.restorePluginState.mockRejectedValue(new Error('replacement rejected'));

        const result = setExternalPluginState({ intent: 'replacement', deviceId: 'd1', stateChunk: 'Y2h1bms=' });
        // The push failure must not fail the committed write.
        await expect(result.pushReplacementToHost?.()).resolves.toBeUndefined();

        expect(mocks.restorePluginState).toHaveBeenCalledExactlyOnceWith('inst-1', 'Y2h1bms=');
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    it('does not push or clear for a device with no failed-restore marker', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'd1', externalInstanceId: 'inst-1' }] }],
        });

        const result = setExternalPluginState({ intent: 'replacement', deviceId: 'd1', stateChunk: 'x' });

        expect(result.didWrite).toBe(true);
        expect(result.pushReplacementToHost).toBeUndefined();
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    it('does not push or clear when the written device carries no instance', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [{ id: 'd1' }] }] });

        const result = setExternalPluginState({ intent: 'replacement', deviceId: 'd1', stateChunk: 'x' });

        expect(result.didWrite).toBe(true);
        expect(result.pushReplacementToHost).toBeUndefined();
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    it('reports no-write and does not mutate when the device is absent', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', devices: [{ id: 'other' }] }] });

        const result = setExternalPluginState({ intent: 'replacement', deviceId: 'd1', stateChunk: 'x' });

        expect(result.didWrite).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });

    it('reports no-write when there is no track state', () => {
        mocks.getTrackState.mockReturnValue(null);

        const result = setExternalPluginState({ intent: 'replacement', deviceId: 'd1', stateChunk: 'x' });

        expect(result.didWrite).toBe(false);
        expect(mocks.mapAllTracks).not.toHaveBeenCalled();
        expect(mocks.restorePluginState).not.toHaveBeenCalled();
        expect(mocks.clearExternalPluginRestoreFailure).not.toHaveBeenCalled();
    });
});
