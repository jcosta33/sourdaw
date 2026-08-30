import { describe, expect, it, vi } from 'vitest';

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
    it('keeps late activation fenced after successful quiesce destroys the renderer', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin.mockResolvedValue([[], []]);
        runtime.loadPlugin.mockResolvedValue({
            instance_id: 'after-close',
            parameters: [],
            latency_samples: 0,
            latency_ms: 0,
            engine_plugin_id: 1,
        });
        const { quiesceProjectSession } = await import('../quiesceProjectSession');
        const { activateExternalPlugin } = await import('#/modules/PluginHost/useCases');

        await expect(quiesceProjectSession(94, async () => true)).resolves.toBe('success');
        const activation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'after-close',
        });
        await Promise.resolve();
        expect(runtime.loadPlugin).not.toHaveBeenCalled();

        await Promise.resolve();
        expect(runtime.loadPlugin).not.toHaveBeenCalled();
        void activation.catch(() => undefined);
    });
});
