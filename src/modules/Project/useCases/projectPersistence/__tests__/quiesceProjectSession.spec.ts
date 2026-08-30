import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    stopPlayback: vi.fn(),
    resetAudioGraph: vi.fn(),
    unloadPlugin: vi.fn(),
    repairRuntimeGraphFromProject: vi.fn(),
    beginProjectSessionPluginRetirement: vi.fn(),
    retire: vi.fn(),
    reopen: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', () => ({
    stopPlayback: runtime.stopPlayback,
    repairRuntimeGraphFromProject: runtime.repairRuntimeGraphFromProject,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({ resetAudioGraph: runtime.resetAudioGraph }));
vi.mock('#/modules/PluginHost/useCases', () => ({
    beginProjectSessionPluginRetirement: runtime.beginProjectSessionPluginRetirement,
}));

describe('quiesceProjectSession', () => {
    beforeEach(() => {
        vi.resetModules();
        runtime.stopPlayback.mockReset();
        runtime.resetAudioGraph.mockReset();
        runtime.unloadPlugin.mockReset();
        runtime.repairRuntimeGraphFromProject.mockReset();
        runtime.beginProjectSessionPluginRetirement.mockReset().mockImplementation(async () => ({
            retire: runtime.retire,
            reopen: runtime.reopen,
        }));
        runtime.retire.mockReset().mockImplementation(() => runtime.unloadPlugin());
        runtime.reopen.mockReset();
    });

    it('stops playback, drops the live graph, then unloads project plugin instances', async () => {
        const order: string[] = [];
        runtime.stopPlayback.mockImplementation(async () => order.push('stop'));
        runtime.resetAudioGraph.mockImplementation(() => order.push('graph'));
        runtime.unloadPlugin.mockImplementation(async () => order.push('plugins'));

        const { quiesceProjectSession } = await import('../quiesceProjectSession');
        await expect(
            quiesceProjectSession(1, async () => {
                order.push('commit');
                return true;
            })
        ).resolves.toBe(true);

        expect(order).toEqual(['stop', 'commit', 'graph', 'plugins']);
    });

    it('fails closed before destructive teardown and repairs the reusable runtime after plugin unload rejection', async () => {
        runtime.stopPlayback.mockRejectedValueOnce(new Error('transport unavailable'));
        let { quiesceProjectSession } = await import('../quiesceProjectSession');

        await expect(quiesceProjectSession(1)).resolves.toBe(false);
        expect(runtime.resetAudioGraph).not.toHaveBeenCalled();

        vi.resetModules();
        runtime.stopPlayback.mockReset().mockResolvedValue(undefined);
        runtime.resetAudioGraph.mockReset();
        runtime.unloadPlugin.mockReset().mockRejectedValueOnce(new Error('plugin release failed'));
        runtime.repairRuntimeGraphFromProject.mockResolvedValue(undefined);
        ({ quiesceProjectSession } = await import('../quiesceProjectSession'));

        await expect(quiesceProjectSession(1)).resolves.toBe(false);
        expect(runtime.repairRuntimeGraphFromProject).toHaveBeenCalledOnce();
        expect(runtime.reopen).toHaveBeenCalledOnce();
        runtime.unloadPlugin.mockResolvedValue(undefined);
        await expect(quiesceProjectSession(2)).resolves.toBe(true);
        expect(runtime.resetAudioGraph).toHaveBeenCalledTimes(2);
    });

    it('recovers from a rejected commitment handshake and lets a later Close retry', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin.mockResolvedValue(undefined);
        const { quiesceProjectSession } = await import('../quiesceProjectSession');

        await expect(
            quiesceProjectSession(1, async () => Promise.reject(new Error('main window replaced')))
        ).resolves.toBe(false);
        expect(runtime.resetAudioGraph).not.toHaveBeenCalled();

        await expect(quiesceProjectSession(2, async () => true)).resolves.toBe(true);
        expect(runtime.resetAudioGraph).toHaveBeenCalledTimes(1);
    });

    it('repairs a started teardown when close authority is revoked while plugin retirement is pending', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        let releasePlugin!: () => void;
        runtime.unloadPlugin.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releasePlugin = resolve;
                })
        );
        runtime.repairRuntimeGraphFromProject.mockResolvedValue(undefined);
        const { cancelProjectSessionQuiesce } = await import('../cancelProjectSessionQuiesce');
        const { quiesceProjectSession } = await import('../quiesceProjectSession');

        const quiescing = quiesceProjectSession(7, async () => true);
        await vi.waitFor(() => expect(runtime.unloadPlugin).toHaveBeenCalledOnce());
        const cancelling = cancelProjectSessionQuiesce(7);
        releasePlugin();

        await expect(quiescing).resolves.toBe(false);
        await expect(cancelling).resolves.toBe(false);
        expect(runtime.repairRuntimeGraphFromProject).toHaveBeenCalledOnce();
    });

    it('ignores a stale cancellation and blocks retry until the matching cancelled teardown repairs', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin.mockResolvedValue(undefined);
        let releaseRepair!: () => void;
        runtime.repairRuntimeGraphFromProject.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    releaseRepair = resolve;
                })
        );
        const { cancelProjectSessionQuiesce } = await import('../cancelProjectSessionQuiesce');
        const { quiesceProjectSession } = await import('../quiesceProjectSession');

        await expect(quiesceProjectSession(11, async () => true)).resolves.toBe(true);
        const cancelling = cancelProjectSessionQuiesce(11);
        await expect(quiesceProjectSession(12, async () => true)).resolves.toBe(false);
        await expect(cancelProjectSessionQuiesce(10)).resolves.toBe(false);
        expect(runtime.repairRuntimeGraphFromProject).toHaveBeenCalledOnce();

        releaseRepair();
        await expect(cancelling).resolves.toBe(false);
        await expect(quiesceProjectSession(12, async () => true)).resolves.toBe(true);
    });

    it('publishes the Project recovery-failure surface and keeps close admission locked when repair also fails', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin.mockRejectedValueOnce(new Error('unload failed'));
        runtime.repairRuntimeGraphFromProject.mockRejectedValueOnce(new Error('repair failed'));
        const { projectLoadFailureStore } = await import('../../../stores/projectLoadFailureStore');
        const { quiesceProjectSession } = await import('../quiesceProjectSession');

        await expect(quiesceProjectSession(21, async () => true)).resolves.toBe(false);
        expect(projectLoadFailureStore.value?.message).toMatch(/could not safely restore/u);
        await expect(quiesceProjectSession(22, async () => true)).resolves.toBe(false);
    });
});
