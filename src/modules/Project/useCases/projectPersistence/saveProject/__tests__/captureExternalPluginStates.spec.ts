import { describe, it, expect, vi, beforeEach } from 'vitest';

import { capturedNativePluginStateCache } from '../capturedNativePluginStateCache';
import { captureExternalPluginStates } from '../captureExternalPluginStates';

type MockDevice = {
    id: string;
    type: string;
    externalInstanceId?: string;
    externalStateChunk?: string;
};

const mocks = vi.hoisted(() => ({
    trackStore: { value: null as { tracks: { id: string; devices: unknown[] }[] } | null },
    executeAppAction: vi.fn<(action: unknown, options?: unknown) => Promise<void>>(),
    readPluginState: vi.fn<(instanceId: string) => Promise<string>>(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: mocks.trackStore }));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({ readPluginState: mocks.readPluginState }));

function setTrackDevices(devices: MockDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: 't1', devices }] };
}

describe('captureExternalPluginStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = null;
        mocks.executeAppAction.mockResolvedValue(undefined);
        capturedNativePluginStateCache.clear();
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

    it('skips a chunk that is unchanged from what is already stored', async () => {
        setTrackDevices([
            { id: 'd1', type: 'external-plugin', externalInstanceId: 'inst-1', externalStateChunk: 'same' },
        ]);
        mocks.readPluginState.mockResolvedValue('same');

        await captureExternalPluginStates();

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
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

    it('no-ops without a live project', async () => {
        mocks.trackStore.value = null;

        await captureExternalPluginStates();

        expect(mocks.readPluginState).not.toHaveBeenCalled();
    });
});
