import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ stopPlayback: vi.fn(), resetAudioGraph: vi.fn(), unloadPlugin: vi.fn() }));

vi.mock('#/modules/Transport/useCases', () => ({ stopPlayback: runtime.stopPlayback }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ resetAudioGraph: runtime.resetAudioGraph }));
vi.mock('#/modules/PluginHost/useCases', () => ({ unloadPlugin: runtime.unloadPlugin }));

describe('quiesceProjectSession', () => {
    beforeEach(() => {
        vi.resetModules();
        runtime.stopPlayback.mockReset();
        runtime.resetAudioGraph.mockReset();
        runtime.unloadPlugin.mockReset();
    });

    it('stops playback, drops the live graph, then unloads project plugin instances', async () => {
        const order: string[] = [];
        runtime.stopPlayback.mockImplementation(async () => order.push('stop'));
        runtime.resetAudioGraph.mockImplementation(() => order.push('graph'));
        runtime.unloadPlugin.mockImplementation(async () => order.push('plugins'));

        const { quiesceProjectSession } = await import('../quiesceProjectSession');
        await expect(
            quiesceProjectSession(async () => {
                order.push('commit');
                return true;
            })
        ).resolves.toBe(true);

        expect(order).toEqual(['stop', 'commit', 'graph', 'plugins']);
    });

    it('fails closed before destructive teardown, but completes the irreversible close after plugin unload rejection', async () => {
        runtime.stopPlayback.mockRejectedValueOnce(new Error('transport unavailable'));
        let { quiesceProjectSession } = await import('../quiesceProjectSession');

        await expect(quiesceProjectSession()).resolves.toBe(false);
        expect(runtime.resetAudioGraph).not.toHaveBeenCalled();

        vi.resetModules();
        runtime.stopPlayback.mockReset().mockResolvedValue(undefined);
        runtime.resetAudioGraph.mockReset();
        runtime.unloadPlugin.mockReset().mockRejectedValueOnce(new Error('plugin release failed'));
        ({ quiesceProjectSession } = await import('../quiesceProjectSession'));

        await expect(quiesceProjectSession()).resolves.toBe(true);
        await expect(quiesceProjectSession()).resolves.toBe(true);
        expect(runtime.resetAudioGraph).toHaveBeenCalledTimes(1);
    });

    it('recovers from a rejected commitment handshake and lets a later Close retry', async () => {
        runtime.stopPlayback.mockResolvedValue(undefined);
        runtime.unloadPlugin.mockResolvedValue(undefined);
        const { quiesceProjectSession } = await import('../quiesceProjectSession');

        await expect(
            quiesceProjectSession(async () => Promise.reject(new Error('main window replaced')))
        ).resolves.toBe(false);
        expect(runtime.resetAudioGraph).not.toHaveBeenCalled();

        await expect(quiesceProjectSession(async () => true)).resolves.toBe(true);
        expect(runtime.resetAudioGraph).toHaveBeenCalledTimes(1);
    });
});
