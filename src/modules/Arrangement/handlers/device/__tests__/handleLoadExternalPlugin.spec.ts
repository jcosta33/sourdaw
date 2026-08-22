import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type HandlerValidationContext } from '#/utils/handlerContract';

import { handleLoadExternalPlugin } from '../handleLoadExternalPlugin';

const mocks = vi.hoisted(() => ({
    addExternalDevice: vi.fn(),
    addTrack: vi.fn(),
    applyDeviceChainRuntimeDelta: vi.fn(),
    findSupportedPlugin: vi.fn(),
    getTrackStoreState: vi.fn(),
    reportLatency: vi.fn(),
    activateExternalPlugin: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: mocks.activateExternalPlugin,
    findSupportedPlugin: mocks.findSupportedPlugin,
    findPluginByName: mocks.findSupportedPlugin,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({ reportLatency: mocks.reportLatency }));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: mocks.addTrack,
}));

vi.mock('../../../useCases/device/addExternalDevice', () => ({
    addExternalDevice: mocks.addExternalDevice,
}));

vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('handleLoadExternalPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findSupportedPlugin.mockReturnValue({ id: 'plugin-1', name: 'Compressor', category: 'Effect' });
    });

    it('reports a write when the external device is added to a provided track', async () => {
        mocks.addExternalDevice.mockReturnValue({ id: 'device-1' });

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        });

        expect(mocks.addExternalDevice).toHaveBeenCalledWith('audio-1', 'plugin-1', 'Compressor');
        expect(result).toEqual({ status: 'written' });
    });

    it('forwards grouped same-track context to the deferred runtime delta', async () => {
        const action = {
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        } as const;
        const batchContext = {
            actionIndex: 0,
            actions: [
                action,
                {
                    type: 'addDevice',
                    payload: { trackId: 'audio-1', deviceType: 'builtin-eq', deviceId: 'device-2' },
                },
            ],
        } satisfies HandlerValidationContext;
        const before = { id: 'audio-1', kind: 'audio' as const, devices: [] };
        const device = {
            id: 'device-1',
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [before] });
        mocks.addExternalDevice.mockReturnValue(device);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });

        const result = await handleLoadExternalPlugin.execute(action, batchContext);
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred external-plugin runtime effect');
        }
        result.afterCommit();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledWith({
            before,
            after: { ...before, devices: [device] },
            operation: 'add-device',
            batchContext,
        });
        expect(mocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({ pluginId: 'plugin-1', instanceId: 'instance-1' })
        );
    });

    it('reports no-write when a provided dormant VCA rejects the device', async () => {
        mocks.addExternalDevice.mockReturnValue(null);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'vca-1' },
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('reports the new track creation as a write even if device addition is rejected afterward', async () => {
        mocks.addTrack.mockReturnValue({ id: 'new-track' });
        mocks.addExternalDevice.mockReturnValue(null);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addExternalDevice).toHaveBeenCalledWith('new-track', 'plugin-1', 'Compressor');
        expect(result).toEqual({ status: 'written' });
    });

    it('reports no-write when implicit track creation fails', async () => {
        mocks.addTrack.mockReturnValue(null);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addExternalDevice).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('creates a midi track for an instrument plugin when no track is provided', async () => {
        mocks.findSupportedPlugin.mockReturnValue({ id: 'plugin-1', name: 'Synth', category: 'Instrument' });
        mocks.addTrack.mockReturnValue({ id: 'midi-track' });
        mocks.addExternalDevice.mockReturnValue({ id: 'device-1' });

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Synth', kind: 'midi' });
        expect(result).toEqual({ status: 'written' });
    });

    it('rejects an unknown plugin before creating a track or device', async () => {
        mocks.findSupportedPlugin.mockReturnValue(undefined);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1' },
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addExternalDevice).not.toHaveBeenCalled();
        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description naming the plugin id', () => {
        const desc = handleLoadExternalPlugin.describe({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'compressor-x' },
        });
        expect(desc.label).toBe('Load external plugin "compressor-x"');
    });

    it('is not undoable', () => {
        expect(handleLoadExternalPlugin.undoable).toBe(false);
    });
});
