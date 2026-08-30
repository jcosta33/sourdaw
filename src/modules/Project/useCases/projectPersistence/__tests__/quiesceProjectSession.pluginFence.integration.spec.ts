import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    stopPlayback: vi.fn(),
    resetAudioGraph: vi.fn(),
    repairRuntimeGraphFromProject: vi.fn(),
    unloadPlugin: vi.fn(),
    loadPlugin: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: runtime.stopPlayback,
    repairRuntimeGraphFromProject: runtime.repairRuntimeGraphFromProject,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({ resetAudioGraph: runtime.resetAudioGraph }));
vi.mock('#/modules/PluginHost/repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: runtime.unloadPlugin }));
vi.mock('#/modules/PluginHost/repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: runtime.loadPlugin }));
vi.mock('#/modules/PluginHost/repositories/pluginBridge/onPluginLatencyChanged', () => ({
    onPluginLatencyChanged: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));

describe('project-session plugin retirement integration', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('keeps real PluginHost activation admission closed when unload and runtime repair both fail', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin.mockRejectedValueOnce(new Error('native unload failed'));
        runtime.repairRuntimeGraphFromProject.mockRejectedValueOnce(new Error('runtime repair failed'));
        const { quiesceProjectSession } = await import('../quiesceProjectSession');
        const { activateExternalPlugin } = await import('#/modules/PluginHost/useCases');

        await expect(quiesceProjectSession(91, async () => true)).resolves.toBe('terminal');
        const activation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'must-not-enter-quarantined-host',
        });

        await Promise.resolve();
        expect(runtime.loadPlugin).not.toHaveBeenCalled();
        void activation.catch(() => undefined);
    });

    it('awaits pre-admitted repair work before reporting terminal and leaves no loaded instance', async () => {
        const repair = Promise.withResolvers<void>();
        const activationLoad = Promise.withResolvers<{
            instance_id: string;
            parameters: never[];
            latency_samples: number;
            latency_ms: number;
            bridge_round_trip_frames: number;
            engine_plugin_id: number;
        }>();
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin
            .mockRejectedValueOnce(new Error('initial native unload failed'))
            .mockResolvedValueOnce([['repair-admitted-instance'], []]);
        runtime.repairRuntimeGraphFromProject.mockReturnValueOnce(repair.promise);
        runtime.loadPlugin.mockReturnValueOnce(activationLoad.promise);
        const { quiesceProjectSession } = await import('../quiesceProjectSession');
        const { activateExternalPlugin } = await import('#/modules/PluginHost/useCases');
        const { externalPluginActivationStore } = await import('#/modules/PluginHost/stores');

        const quiescing = quiesceProjectSession(92, async () => true);
        await vi.waitFor(() => expect(runtime.repairRuntimeGraphFromProject).toHaveBeenCalledOnce());
        const activation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'repair-admitted-instance',
        });
        await vi.waitFor(() => expect(runtime.loadPlugin).toHaveBeenCalledOnce());
        repair.reject(new Error('runtime repair failed'));

        const beforeActivationRelease = await Promise.race([
            quiescing.then(() => 'settled' as const),
            new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
        ]);
        expect(beforeActivationRelease).toBe('pending');
        expect(runtime.unloadPlugin).toHaveBeenCalledOnce();

        activationLoad.resolve({
            instance_id: 'repair-admitted-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 2,
            bridge_round_trip_frames: 256,
            engine_plugin_id: 1002,
        });
        await expect(activation).resolves.toMatchObject({ status: 'failed', stage: 'attach' });
        await vi.waitFor(() => expect(runtime.unloadPlugin).toHaveBeenCalledTimes(2));

        await expect(quiescing).resolves.toBe('terminal');
        expect(externalPluginActivationStore.value?.byInstanceId).toEqual({});
    });
});
