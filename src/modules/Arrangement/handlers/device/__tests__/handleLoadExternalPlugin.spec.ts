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
    reportBridgeRoundTripFrames: vi.fn(),
    getLiveEngineSampleRate: vi.fn<() => number | undefined>(() => 96_000),
    activateExternalPlugin: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: mocks.activateExternalPlugin,
    findSupportedPlugin: mocks.findSupportedPlugin,
    findPluginByName: mocks.findSupportedPlugin,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getLiveEngineSampleRate: mocks.getLiveEngineSampleRate,
    reportBridgeRoundTripFrames: mocks.reportBridgeRoundTripFrames,
    reportLatency: mocks.reportLatency,
}));

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
        // `clearAllMocks` clears calls, not implementations, so a test that
        // takes the engine away has to hand it back here.
        mocks.getLiveEngineSampleRate.mockReturnValue(96_000);
        mocks.findSupportedPlugin.mockReturnValue({ id: 'plugin-1', name: 'Compressor', category: 'Effect' });
        mocks.activateExternalPlugin.mockResolvedValue({ status: 'active' });
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
            name: 'Compressor',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [before] })
            .mockReturnValue({ tracks: [{ ...before, devices: [device] }] });
        mocks.addExternalDevice.mockReturnValue(device);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });

        const result = await handleLoadExternalPlugin.execute(action, batchContext);
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred external-plugin runtime effect');
        }
        await result.afterCommit();

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

    it.each([
        ['removed', []],
        [
            'replaced',
            [
                {
                    id: 'device-1',
                    name: 'Replacement',
                    type: 'external-plugin',
                    bypassed: false,
                    parameterValues: {},
                    externalPluginId: 'plugin-2',
                    externalInstanceId: 'instance-2',
                },
            ],
        ],
    ])(
        'skips host activation when a later same-track mutation %s the committed discharged device',
        async (_label, finalDevices) => {
            const action = {
                type: 'loadExternalPlugin',
                payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
            } as const;
            const batchContext = {
                actionIndex: 0,
                actions: [
                    action,
                    {
                        type: 'removeDevice',
                        payload: { deviceId: 'device-1', expectedTrackId: 'audio-1' },
                    },
                ],
            } satisfies HandlerValidationContext;
            const before = { id: 'audio-1', kind: 'audio' as const, devices: [] };
            const device = {
                id: 'device-1',
                name: 'Compressor',
                type: 'external-plugin',
                bypassed: false,
                parameterValues: {},
                externalPluginId: 'plugin-1',
                externalInstanceId: 'instance-1',
            };
            mocks.getTrackStoreState
                .mockReturnValueOnce({ tracks: [before] })
                .mockReturnValue({ tracks: [{ ...before, devices: finalDevices }] });
            mocks.addExternalDevice.mockReturnValue(device);
            mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
                acceptance: 'superseded',
                application: 'discharged',
                reason: 'Live runtime already matches final project truth',
            });

            const result = await handleLoadExternalPlugin.execute(action, batchContext);
            if (!result || result.status !== 'written' || !result.afterCommit) {
                throw new Error('Expected a deferred external-plugin runtime effect');
            }
            await result.afterCommit();
            await result.afterAmbiguousCommit?.();

            expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
            expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(2);
            expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
            expect(mocks.reportLatency).not.toHaveBeenCalled();
        }
    );

    it('activates a still-authoritative discharged external device once', async () => {
        const before = { id: 'audio-1', kind: 'audio' as const, devices: [] };
        const device = {
            id: 'device-1',
            name: 'Compressor',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [before] })
            .mockReturnValue({ tracks: [{ ...before, devices: [device] }] });
        mocks.addExternalDevice.mockReturnValue(device);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'superseded',
            application: 'discharged',
            reason: 'Live runtime already matches final project truth',
        });

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        });
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred external-plugin runtime effect');
        }
        await result.afterCommit();
        await result.afterAmbiguousCommit?.();

        expect(mocks.getTrackStoreState).toHaveBeenCalledTimes(2);
        expect(mocks.activateExternalPlugin).toHaveBeenCalledOnce();
        expect(mocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({
                pluginId: 'plugin-1',
                instanceId: 'instance-1',
                // The rate this engine renders at, read live rather than
                // assumed: the plugin processes the audio this graph produces.
                engineSampleRate: 96_000,
            })
        );
        const activation = mocks.activateExternalPlugin.mock.calls[0]?.[0];
        expect(activation?.onLatencyMs).toEqual(expect.any(Function));
        activation?.onLatencyMs?.(9);
        expect(mocks.reportLatency).toHaveBeenCalledWith('device-1', 9);
        expect(activation?.onBridgeRoundTripFrames).toEqual(expect.any(Function));
        activation?.onBridgeRoundTripFrames?.(1408);
        expect(mocks.reportBridgeRoundTripFrames).toHaveBeenCalledWith('device-1', 1408);
    });

    it('refuses to activate at a guessed rate while the engine renders no audio', async () => {
        const before = { id: 'audio-1', kind: 'audio' as const, devices: [] };
        const device = {
            id: 'device-1',
            name: 'Compressor',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [before] })
            .mockReturnValue({ tracks: [{ ...before, devices: [device] }] });
        mocks.addExternalDevice.mockReturnValue(device);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        mocks.getLiveEngineSampleRate.mockReturnValue(undefined);

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        });
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred external-plugin runtime effect');
        }

        // The engine is on its silent fallback shim, whose context reports a
        // confident 44100. Substituting that would activate the plugin on a
        // clock it is not fed, and the native rate guard would never see a
        // value to refuse. The post-commit contract routes this to repair.
        await expect(result.afterCommit()).rejects.toThrow('not rendering audio');
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });

    // The ordinary order a project opens in: no engine is running until the
    // first play, so the plugin loads with its attachment pending. Reporting
    // that as a failed activation raised out of the committed action that added
    // the device, on nothing having gone wrong.
    it('commits a plugin whose engine attachment is still pending', async () => {
        const before = { id: 'audio-1', kind: 'audio' as const, devices: [] };
        const device = {
            id: 'device-1',
            name: 'Compressor',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [before] })
            .mockReturnValue({ tracks: [{ ...before, devices: [device] }] });
        mocks.addExternalDevice.mockReturnValue(device);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        mocks.activateExternalPlugin.mockResolvedValue({ status: 'active', attachment: 'pending' });

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        });
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred external-plugin runtime effect');
        }

        await expect(result.afterCommit()).resolves.toBeUndefined();
        await expect(result.afterAmbiguousCommit?.()).resolves.toBeUndefined();
    });

    it('classifies a retained native attach failure for whole-graph repair', async () => {
        const before = { id: 'audio-1', kind: 'audio' as const, devices: [] };
        const device = {
            id: 'device-1',
            name: 'Compressor',
            type: 'external-plugin',
            bypassed: false,
            parameterValues: {},
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
        };
        mocks.getTrackStoreState
            .mockReturnValueOnce({ tracks: [before] })
            .mockReturnValue({ tracks: [{ ...before, devices: [device] }] });
        mocks.addExternalDevice.mockReturnValue(device);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({ acceptance: 'accepted', application: 'applied' });
        mocks.activateExternalPlugin.mockResolvedValue({
            status: 'failed',
            stage: 'attach',
            reason: 'native engine unavailable',
        });

        const result = await handleLoadExternalPlugin.execute({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        });
        if (!result || result.status !== 'written' || !result.afterCommit) {
            throw new Error('Expected a deferred external-plugin runtime effect');
        }

        await expect(result.afterCommit()).rejects.toThrow('native engine unavailable');
        await expect(result.afterAmbiguousCommit?.()).rejects.toThrow('native engine unavailable');
        expect(result.postCommitEffect).toEqual({ kind: 'runtime-graph', remediation: 'repair' });
        expect(mocks.activateExternalPlugin).toHaveBeenCalledTimes(2);
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
