import { beforeEach, describe, expect, it, vi } from 'vitest';

import { externalPluginTailStore } from '../../../stores/externalPluginTailStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { refreshExternalPluginTails } from '../refreshExternalPluginTails';
import { unloadPlugin } from '../unloadPlugin';

import type { PluginInstance, PluginTailReading } from '../../../repositories/pluginBridge/types';

// A VST3 plugin raises no tail-changed event, so the figure is re-read on
// demand: the real activation and unload use cases down to the IPC repository
// boundary, which is mocked.
const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string) => Promise<PluginInstance>>(),
    unloadPluginRepo: vi.fn<(instanceId?: string) => Promise<unknown>>(),
    readPluginTailsRepo: vi.fn<(instanceIds: readonly string[]) => Promise<PluginTailReading[]>>(),
    loggerWarn: vi.fn<(message: string) => void>(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/readPluginTails', () => ({ readPluginTails: mocks.readPluginTailsRepo }));
vi.mock('../../../repositories/pluginBridge/onPluginTailChanged', () => ({
    onPluginTailChanged: () => Promise.resolve(() => {}),
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.loggerWarn } }));

function loadedInstance(instanceId: string, tailSamples: number): PluginInstance {
    return {
        instance_id: instanceId,
        plugin_id: 'reverb',
        name: 'Reverb',
        parameters: [],
        is_active: true,
        latency_samples: 0,
        latency_ms: 0,
        tail_samples: tailSamples,
        engine_plugin_id: 7,
    };
}

function tailOf(instanceId: string): number | undefined {
    return externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId];
}

describe('refreshExternalPluginTails', () => {
    beforeEach(() => {
        clearLoadedExternalPlugins();
        vi.clearAllMocks();
        mocks.unloadPluginRepo.mockImplementation((instanceId) =>
            Promise.resolve({
                unloadedInstanceIds: instanceId === undefined ? [] : [instanceId],
                errors: [],
                reports: [],
            })
        );
        mocks.loadPluginRepo.mockImplementation((_pluginId, instanceId) =>
            Promise.resolve(loadedInstance(instanceId, 96_000))
        );
    });

    it('revises a loaded instance to the tail the host reads now', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        mocks.readPluginTailsRepo.mockResolvedValue([{ instance_id: 'inst-1', tail_samples: 240_000 }]);

        await refreshExternalPluginTails();

        expect(mocks.readPluginTailsRepo).toHaveBeenCalledWith(['inst-1']);
        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('keeps the stored tail of an instance the host left out of its answer', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-2' });
        mocks.readPluginTailsRepo.mockResolvedValue([{ instance_id: 'inst-2', tail_samples: 48_000 }]);

        await refreshExternalPluginTails();

        expect(tailOf('inst-1')).toBe(96_000);
        expect(tailOf('inst-2')).toBe(48_000);
    });

    it('does not revive an instance unloaded while the host was answering', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValue(answer.promise);

        const refresh = refreshExternalPluginTails();
        await vi.waitFor(() => expect(mocks.readPluginTailsRepo).toHaveBeenCalledTimes(1));
        await unloadPlugin('inst-1');
        answer.resolve([{ instance_id: 'inst-1', tail_samples: 240_000 }]);
        await refresh;

        expect(tailOf('inst-1')).toBeUndefined();
    });

    it('keeps every stored tail and warns when the read is rejected', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        mocks.readPluginTailsRepo.mockRejectedValue(new Error('host unavailable'));

        await expect(refreshExternalPluginTails()).resolves.toBeUndefined();

        expect(tailOf('inst-1')).toBe(96_000);
        expect(mocks.loggerWarn).toHaveBeenCalledWith(expect.stringContaining('host unavailable'));
    });

    it('makes no IPC call when nothing is loaded', async () => {
        await refreshExternalPluginTails();

        expect(mocks.readPluginTailsRepo).not.toHaveBeenCalled();
    });
});
