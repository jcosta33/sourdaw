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
    it('keeps real PluginHost activation admission closed when unload and runtime repair both fail', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin.mockRejectedValueOnce(new Error('native unload failed'));
        runtime.repairRuntimeGraphFromProject.mockRejectedValueOnce(new Error('runtime repair failed'));
        const { quiesceProjectSession } = await import('../quiesceProjectSession');
        const { activateExternalPlugin } = await import('#/modules/PluginHost/useCases');

        await expect(quiesceProjectSession(91, async () => true)).resolves.toBe(false);
        const activation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'must-not-enter-quarantined-host',
        });

        await Promise.resolve();
        expect(runtime.loadPlugin).not.toHaveBeenCalled();
        void activation.catch(() => undefined);
    });
});
