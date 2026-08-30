import { beforeEach, describe, expect, it, vi } from 'vitest';

import { quiesceProjectSession } from '../quiesceProjectSession';

const runtime = vi.hoisted(() => ({ stopPlayback: vi.fn(), resetAudioGraph: vi.fn(), unloadPlugin: vi.fn() }));

vi.mock('#/modules/Transport/useCases', () => ({ stopPlayback: runtime.stopPlayback }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ resetAudioGraph: runtime.resetAudioGraph }));
vi.mock('#/modules/PluginHost/useCases', () => ({ unloadPlugin: runtime.unloadPlugin }));

describe('quiesceProjectSession', () => {
    beforeEach(() => {
        runtime.stopPlayback.mockReset();
        runtime.resetAudioGraph.mockReset();
        runtime.unloadPlugin.mockReset();
    });

    it('stops playback, drops the live graph, then unloads project plugin instances', async () => {
        const order: string[] = [];
        runtime.stopPlayback.mockImplementation(async () => order.push('stop'));
        runtime.resetAudioGraph.mockImplementation(() => order.push('graph'));
        runtime.unloadPlugin.mockImplementation(async () => order.push('plugins'));

        await expect(quiesceProjectSession()).resolves.toBe(true);

        expect(order).toEqual(['stop', 'graph', 'plugins']);
    });

    it('fails closed when a renderer-owned teardown step fails', async () => {
        runtime.stopPlayback.mockRejectedValueOnce(new Error('transport unavailable'));

        await expect(quiesceProjectSession()).resolves.toBe(false);
        expect(runtime.resetAudioGraph).not.toHaveBeenCalled();
    });
});
