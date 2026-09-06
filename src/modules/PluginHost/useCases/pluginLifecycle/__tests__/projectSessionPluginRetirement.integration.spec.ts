import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { unloadPlugin as unloadPluginRepoSignature } from '../../../repositories/pluginBridge/unloadPlugin';

const runtime = vi.hoisted(() => ({
    stopPlayback: vi.fn(),
    resetAudioGraph: vi.fn(),
    repairRuntimeGraphFromProject: vi.fn(),
    loadPlugin: vi.fn(),
    unloadPlugin: vi.fn<typeof unloadPluginRepoSignature>(),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    stopPlayback: runtime.stopPlayback,
    repairRuntimeGraphFromProject: runtime.repairRuntimeGraphFromProject,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    resetAudioGraph: runtime.resetAudioGraph,
}));
vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: runtime.loadPlugin }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: runtime.unloadPlugin }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));

const loadRealContracts = async () => {
    const { quiesceProjectSession } = await import('#/modules/Project/useCases');
    const { activateExternalPlugin } = await import('../activateExternalPlugin');
    return { quiesceProjectSession, activateExternalPlugin };
};

const attemptLateActivation = async (
    activateExternalPlugin: Awaited<ReturnType<typeof loadRealContracts>>['activateExternalPlugin'],
    instanceId: string
): Promise<void> => {
    const activation = activateExternalPlugin({
        engineSampleRate: 48_000,
        pluginId: 'compressor',
        instanceId,
    });
    void activation.catch(() => undefined);
    await Promise.resolve();
};

describe('Project session PluginHost retirement boundary', () => {
    beforeAll(async () => {
        await import('#/modules/Project/useCases');
    });

    beforeEach(() => {
        vi.resetModules();
        runtime.stopPlayback.mockReset().mockResolvedValue(undefined);
        runtime.resetAudioGraph.mockReset();
        runtime.repairRuntimeGraphFromProject.mockReset().mockResolvedValue(undefined);
        runtime.loadPlugin.mockReset().mockResolvedValue({
            instance_id: 'late-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 0,
            engine_plugin_id: 1,
        });
        runtime.unloadPlugin.mockReset().mockResolvedValue({ unloadedInstanceIds: [], errors: [], reports: [] });
    });

    it('keeps native activation fenced after Project reports successful session retirement', async () => {
        const { quiesceProjectSession, activateExternalPlugin } = await loadRealContracts();

        await expect(quiesceProjectSession(101, async () => true)).resolves.toBe('success');
        await attemptLateActivation(activateExternalPlugin, 'after-success');

        expect(runtime.loadPlugin).not.toHaveBeenCalled();
    });

    it('keeps native activation fenced after Project reports terminal repair failure', async () => {
        runtime.unloadPlugin.mockRejectedValue(new Error('native unload failed'));
        runtime.repairRuntimeGraphFromProject.mockRejectedValueOnce(new Error('runtime repair failed'));
        const { quiesceProjectSession, activateExternalPlugin } = await loadRealContracts();

        await expect(quiesceProjectSession(102, async () => true)).resolves.toBe('terminal');
        await attemptLateActivation(activateExternalPlugin, 'after-terminal');

        expect(runtime.loadPlugin).not.toHaveBeenCalled();
    });
});
