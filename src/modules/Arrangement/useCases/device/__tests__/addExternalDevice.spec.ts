import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addExternalDevice } from '../addExternalDevice';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    updateTrack: vi.fn(),
    addDeviceToStrip: vi.fn(),
    activateExternalPlugin: vi.fn(),
    reportLatency: vi.fn(),
    findSupportedPlugin: vi.fn(),
}));

/** The latency sink `addExternalDevice` injected into the activation call. */
function injectedLatencySink(): (latencyMs: number) => void {
    const lastCall = mocks.activateExternalPlugin.mock.calls.at(-1);
    const input = lastCall?.[0] as { onLatencyMs?: (latencyMs: number) => void } | undefined;
    const sink = input?.onLatencyMs;
    if (!sink) {
        throw new Error('activateExternalPlugin was called without a latency sink');
    }
    return sink;
}

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    addDeviceToStrip: mocks.addDeviceToStrip,
    reportLatency: mocks.reportLatency,
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: mocks.activateExternalPlugin,
    findSupportedPlugin: mocks.findSupportedPlugin,
}));

describe('addExternalDevice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'audio-1', kind: 'audio', devices: [] }] });
        mocks.findSupportedPlugin.mockReturnValue({ id: 'plugin-1', format: 'clap' });
    });

    it('persists an external plugin on an ordinary folder without starting runtime work', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'folder-1', kind: 'folder', devices: [] }] });

        const device = addExternalDevice('folder-1', 'plugin-1', 'Plugin');

        expect(device).toMatchObject({ type: 'external-plugin' });
        expect(mocks.updateTrack).toHaveBeenCalledWith('folder-1', expect.any(Function));
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });

    it('adds an external plugin to an already-live Toaster folder', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'folder-1', kind: 'folder', devices: [{ id: 'toaster-1', type: 'toaster' }] }],
        });

        const device = addExternalDevice('folder-1', 'plugin-1', 'Plugin');

        expect(mocks.addDeviceToStrip).toHaveBeenCalledTimes(1);
        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith(
            'folder-1',
            device?.id,
            'external-plugin',
            device?.externalInstanceId
        );
        expect(mocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({
                pluginId: 'plugin-1',
                instanceId: device?.externalInstanceId,
            })
        );
    });

    it('preserves ordinary external plugin creation and runtime loading', () => {
        const device = addExternalDevice('audio-1', 'plugin-1', 'Plugin');

        expect(device).toMatchObject({
            name: 'Plugin',
            type: 'external-plugin',
            externalPluginId: 'plugin-1',
        });
        expect(mocks.updateTrack).toHaveBeenCalledWith('audio-1', expect.any(Function));
        expect(mocks.addDeviceToStrip).toHaveBeenCalledWith(
            'audio-1',
            device?.id,
            'external-plugin',
            device?.externalInstanceId
        );
        expect(mocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({
                pluginId: 'plugin-1',
                instanceId: device?.externalInstanceId,
            })
        );
    });

    it('generates distinct native instance ids for plugins added in the same millisecond', () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(123);

        const first = addExternalDevice('audio-1', 'plugin-1', 'Plugin');
        const second = addExternalDevice('audio-1', 'plugin-1', 'Plugin');

        expect(first?.externalInstanceId).not.toBe(second?.externalInstanceId);
        now.mockRestore();
    });

    it('routes the injected latency sink to the registry under this device id', () => {
        const device = addExternalDevice('audio-1', 'plugin-1', 'Plugin');

        // The sink is keyed by the engine DEVICE id, not the plugin instance id:
        // per-track compensation sums the registry by device.
        injectedLatencySink()(12.5);

        expect(mocks.reportLatency).toHaveBeenCalledWith(device?.id, 12.5);
        expect(device?.id).not.toBe(device?.externalInstanceId);
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
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });

    it('rejects a dormant VCA before ID, instance, project, engine, or plugin work', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca', devices: [] }] });

        expect(addExternalDevice('vca-1', 'plugin-1', 'Plugin')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });

    it('returns null when there is no track state (cleared/absent project)', () => {
        mocks.getTrackState.mockReturnValue(null);

        expect(addExternalDevice('audio-1', 'plugin-1', 'Plugin')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });

    it('rejects an unsupported plugin id before project or runtime work', () => {
        mocks.findSupportedPlugin.mockReturnValue(undefined);

        expect(addExternalDevice('audio-1', 'unsupported-vst', 'Unsupported VST')).toBeNull();
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });
});
