import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('#/modules/Command/useCases', () => ({ executeAppAction: mocks.executeAppAction }));
vi.mock('#/modules/PluginHost/useCases', () => ({ readPluginState: mocks.readPluginState }));

function setTrackDevices(devices: MockDevice[]): void {
    mocks.trackStore.value = { tracks: [{ id: 't1', devices }] };
}

describe('captureExternalPluginStates', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = null;
        mocks.executeAppAction.mockResolvedValue(undefined);
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

    it('no-ops without a live project', async () => {
        mocks.trackStore.value = null;

        await captureExternalPluginStates();

        expect(mocks.readPluginState).not.toHaveBeenCalled();
    });
});
