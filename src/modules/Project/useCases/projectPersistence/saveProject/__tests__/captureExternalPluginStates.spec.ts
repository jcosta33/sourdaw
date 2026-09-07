import { describe, it, expect, vi, beforeEach } from 'vitest';

import { capturedNativePluginStateCache } from '../capturedNativePluginStateCache';
import { captureExternalPluginStates } from '../captureExternalPluginStates';
import { warnedExternalPluginCaptureRejections } from '../warnedExternalPluginCaptureRejections';

type MockDevice = {
    id: string;
    type: string;
    externalInstanceId?: string;
    externalStateChunk?: string;
    externalPluginId?: string;
};

const mocks = vi.hoisted(() => ({
    trackStore: { value: null as { tracks: { id: string; devices: unknown[] }[] } | null },
    executeAppAction: vi.fn<(action: unknown, options?: unknown) => Promise<void>>(),
    isAppActionCommittedError: vi.fn<(error: unknown) => boolean>(() => false),
    readPluginState: vi.fn<(instanceId: string) => Promise<string>>(),
    hasUnresolvedExternalPluginRestoreFailure: vi.fn<(instanceId: string) => boolean>(),
    shouldWarnExternalPluginRestoreFailure: vi.fn<(instanceId: string) => boolean>(),
    notifyUser: vi.fn<(message: string, level?: 'info' | 'success' | 'warning' | 'error') => void>(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
    isAppActionCommittedError: mocks.isAppActionCommittedError,
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    readPluginState: mocks.readPluginState,
    hasUnresolvedExternalPluginRestoreFailure: mocks.hasUnresolvedExternalPluginRestoreFailure,
    shouldWarnExternalPluginRestoreFailure: mocks.shouldWarnExternalPluginRestoreFailure,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

function setTrackDevices(devices: MockDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: 't1', devices }] };
}

describe('captureExternalPluginStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = null;
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.isAppActionCommittedError.mockReturnValue(false);
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(false);
        capturedNativePluginStateCache.clear();
        warnedExternalPluginCaptureRejections.clear();
    });

    it('commits a fresh chunk for a loaded external plugin', async () => {
        setTrackDevices([{ id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1' }]);
        mocks.readPluginState.mockResolvedValue('bmV3');

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setExternalPluginState', payload: { deviceId: 'd1', stateChunk: 'bmV3' } },
            { skipMacroRecording: true }
        );
    });

    it('preserves the stored chunk when the plugin is absent (empty read)', async () => {
        setTrackDevices([
            { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1', externalStateChunk: 'kept' },
        ]);
        mocks.readPluginState.mockResolvedValue('');

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('does not clobber the stored chunk when the read throws', async () => {
        setTrackDevices([
            { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1', externalStateChunk: 'kept' },
        ]);
        mocks.readPluginState.mockRejectedValue(new Error('no such instance'));

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    // Regression (issue 3693): a plugin that instantiated but REJECTED its saved
    // state stays loaded holding its defaults. Committing its get-state would
    // overwrite the original saved chunk with plugin defaults — permanent data
    // loss on the first Save or Export after the failed restore.
    it('preserves the stored chunk while a failed restore is unresolved (host is not read)', async () => {
        setTrackDevices([
            {
                id: 'd1',
                type: 'external-plugin',
                externalInstanceId: 'inst-1',
                externalStateChunk: 'original',
                externalPluginId: 'serum',
            },
        ]);
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(true);
        mocks.shouldWarnExternalPluginRestoreFailure.mockReturnValue(true);
        // The plugin's default state is exactly what must NOT be committed.
        mocks.readPluginState.mockResolvedValue('defaults');

        await captureExternalPluginStates();

        expect(mocks.readPluginState).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(capturedNativePluginStateCache.has('inst-1')).toBe(false);
        // The suppression is not silent: the save names the plugin.
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('serum'), 'warning');
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('preserved'), 'warning');
    });

    // The warning is once per failure episode, not once per save: autosave ticks
    // on a plugin that keeps rejecting its chunk must not nag every 30 seconds,
    // while a resolved-then-refailed instance warns again. The episode tracking
    // itself (what makes the second call false) is pinned end-to-end in the
    // PluginHost integration spec.
    it('warns once per failure episode across saves and again for a new episode', async () => {
        setTrackDevices([
            {
                id: 'd1',
                type: 'external-plugin',
                externalInstanceId: 'inst-1',
                externalStateChunk: 'original',
                externalPluginId: 'serum',
            },
        ]);
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(true);
        mocks.readPluginState.mockResolvedValue('defaults');
        mocks.shouldWarnExternalPluginRestoreFailure
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);

        await captureExternalPluginStates();
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);

        // Resolved, then failed again: a new episode warns again.
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(2);
    });

    it('captures normally again once the failed-restore marker resolves', async () => {
        const device: MockDevice = {
            id: 'd1',
            type: 'external-plugin',
            externalInstanceId: 'inst-1',
            externalStateChunk: 'original',
            externalPluginId: 'serum',
        };
        setTrackDevices([device]);
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(true);
        mocks.shouldWarnExternalPluginRestoreFailure.mockReturnValue(true);
        mocks.readPluginState.mockResolvedValue('defaults');

        await captureExternalPluginStates();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);

        // A successful re-restore or explicit replacement cleared the marker;
        // the host now reports fresh authoritative state.
        mocks.hasUnresolvedExternalPluginRestoreFailure.mockReturnValue(false);
        mocks.readPluginState.mockResolvedValue('fresh');

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'setExternalPluginState', payload: { deviceId: 'd1', stateChunk: 'fresh' } },
            { skipMacroRecording: true }
        );
        // Resolved capture is business as usual — no suppression warning.
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('skips a chunk that is unchanged from what is already stored', async () => {
        setTrackDevices([
            { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1', externalStateChunk: 'same' },
        ]);
        mocks.readPluginState.mockResolvedValue('same');

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    // The store-equal skip must still seed the self-read baseline (issue 3694,
    // collab contract): the first capture enters the skip branch with the host
    // read equal to the stored chunk, and when a collaboration sync later
    // replaces the stored chunk with a peer's value, the unchanged host must
    // keep skipping instead of re-committing our chunk over the peer's.
    // Deleting the recordAcceptedCapture call in that skip branch reds exactly
    // this test.
    it('keeps skipping an unchanged host after a sync replaces the stored chunk, when the first capture took the store-equal skip', async () => {
        const device: MockDevice = {
            id: 'd1',
            type: 'external-plugin',
            externalInstanceId: 'inst-store-equal',
            externalStateChunk: 'same',
        };
        setTrackDevices([device]);
        mocks.readPluginState.mockResolvedValue('same');

        // First capture enters the store-equal skip: nothing to write, but the
        // read must become the baseline.
        await captureExternalPluginStates();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(capturedNativePluginStateCache.get('inst-store-equal')).toBe('same');

        // A sync replaces the stored chunk with the peer's value while the
        // host is untouched: no recapture loop.
        device.externalStateChunk = 'peer-B';

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(mocks.readPluginState).toHaveBeenCalledTimes(2);
    });

    it('ignores built-in devices and external devices without an instance id', async () => {
        setTrackDevices([
            { id: 'builtin', type: 'builtin-synth' },
            { id: 'noinst', type: 'external-plugin' },
        ]);

        await captureExternalPluginStates();

        expect(mocks.readPluginState).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('does not re-commit when the local host state is unchanged after a remote sync overwrote the store (collab ping-pong)', async () => {
        const device: MockDevice = { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-pp' };
        setTrackDevices([device]);
        mocks.readPluginState.mockResolvedValue('local-A');

        // First capture: genuine local state — commits and seeds the self-read baseline.
        await captureExternalPluginStates();
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);

        // A collaboration sync replaces the stored chunk with the peer's value while
        // the local host state is unchanged.
        device.externalStateChunk = 'remote-B';

        await captureExternalPluginStates();

        // No second commit: the local host did not change, so the peer's chunk is
        // left intact instead of being overwritten on every autosave tick.
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
    });

    it('commits again when the local host state genuinely changes', async () => {
        const device: MockDevice = { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-edit' };
        setTrackDevices([device]);
        mocks.readPluginState.mockResolvedValue('edit-A');

        await captureExternalPluginStates();
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        device.externalStateChunk = 'edit-A';

        // The user tweaks the plugin — the host now reports a different chunk.
        mocks.readPluginState.mockResolvedValue('edit-B');

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith(
            { type: 'setExternalPluginState', payload: { deviceId: 'd1', stateChunk: 'edit-B' } },
            { skipMacroRecording: true }
        );
    });

    // Regression (issue 3694): the self-read baseline used to advance BEFORE
    // the command was accepted, so a precommit rejection left the old chunk in
    // project truth while the cache claimed the fresh chunk was captured — the
    // next save skipped the write and the plugin edit was lost for good.
    it('retries the capture on the next save after a precommit rejection, with the host unchanged', async () => {
        setTrackDevices([{ id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1' }]);
        mocks.readPluginState.mockResolvedValue('bmV3');
        mocks.executeAppAction.mockRejectedValueOnce(new Error('command rejected before commit'));

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
        // Nothing was written, so the baseline must not claim the fresh chunk.
        expect(capturedNativePluginStateCache.has('inst-1')).toBe(false);

        // The rejection is gone; the next save retries without touching the plugin.
        await captureExternalPluginStates();

        expect(mocks.executeAppAction).toHaveBeenCalledTimes(2);
        expect(mocks.executeAppAction).toHaveBeenLastCalledWith(
            { type: 'setExternalPluginState', payload: { deviceId: 'd1', stateChunk: 'bmV3' } },
            { skipMacroRecording: true }
        );
    });

    it('names the plugin whose capture was rejected, once per failed-capture episode', async () => {
        setTrackDevices([
            { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1', externalPluginId: 'serum' },
        ]);
        mocks.readPluginState.mockResolvedValue('bmV3');
        mocks.executeAppAction.mockRejectedValue(new Error('command rejected before commit'));

        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('serum'), 'warning');

        // The autosave retries while the rejection stands: no second nag.
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);

        // A capture the machinery accepts ends the episode; a fresh failure warns again.
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.readPluginState.mockResolvedValue('bmV4');
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);

        mocks.executeAppAction.mockRejectedValue(new Error('command rejected before commit'));
        mocks.readPluginState.mockResolvedValue('bmV5');
        await captureExternalPluginStates();
        expect(mocks.notifyUser).toHaveBeenCalledTimes(2);
    });

    it('reports the rejected plugins to the caller so the save cannot read as clean success', async () => {
        setTrackDevices([
            { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1', externalPluginId: 'serum' },
            { id: 'd2', type: 'external-plugin', externalInstanceId: 'inst-2', externalPluginId: 'falcon' },
            { id: 'd3', type: 'external-plugin', externalInstanceId: 'inst-3', externalPluginId: 'diva' },
        ]);
        mocks.readPluginState.mockImplementation((instanceId: string) =>
            Promise.resolve(instanceId === 'inst-3' ? '' : `chunk-${instanceId}`)
        );
        mocks.executeAppAction
            .mockRejectedValueOnce(new Error('command rejected before commit'))
            .mockResolvedValueOnce(undefined);

        const outcome = await captureExternalPluginStates();

        expect(outcome.rejectedPlugins).toEqual(['serum']);
    });

    // A committed-but-observer-error means truth holds the chunk; only
    // post-commit processing failed. The baseline must advance so the
    // unchanged-host skip still holds — otherwise every following save would
    // re-commit the same chunk forever.
    it('records the baseline when the command commits but post-commit processing fails', async () => {
        setTrackDevices([{ id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1' }]);
        mocks.readPluginState.mockResolvedValue('bmV3');
        mocks.executeAppAction.mockRejectedValueOnce(new Error('post-commit failure'));
        mocks.isAppActionCommittedError.mockReturnValueOnce(true);

        await captureExternalPluginStates();

        expect(capturedNativePluginStateCache.get('inst-1')).toBe('bmV3');
        expect(mocks.notifyUser).not.toHaveBeenCalled();

        // Truth holds the chunk, so an unchanged host must not re-commit.
        await captureExternalPluginStates();
        expect(mocks.executeAppAction).toHaveBeenCalledTimes(1);
    });

    it('no-ops without a live project', async () => {
        mocks.trackStore.value = null;

        await captureExternalPluginStates();

        expect(mocks.readPluginState).not.toHaveBeenCalled();
    });
});
