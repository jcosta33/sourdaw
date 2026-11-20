import { beforeEach, describe, expect, it, vi } from 'vitest';

import { externalPluginTailStore } from '../../../stores/externalPluginTailStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { refreshExternalPluginTails } from '../refreshExternalPluginTails';
import { unloadPlugin } from '../unloadPlugin';

import type { PluginInstance, PluginTailChange, PluginTailReading } from '../../../repositories/pluginBridge/types';

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
    onPluginTailChanged: (handler: (change: PluginTailChange) => void) => {
        nativeTailHandler = handler;
        return Promise.resolve(() => {});
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.loggerWarn } }));

/** The handler the single live `plugin-tail-changed` subscription installed. */
let nativeTailHandler: ((change: PluginTailChange) => void) | undefined;

function emitTailChange(change: PluginTailChange): void {
    if (!nativeTailHandler) {
        throw new Error('no native tail subscription is live');
    }
    nativeTailHandler(change);
}

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

    it('does not let an older refresh that resolves last overwrite a newer one', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const olderAnswer = Promise.withResolvers<PluginTailReading[]>();
        const newerAnswer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(olderAnswer.promise).mockReturnValueOnce(newerAnswer.promise);

        const older = refreshExternalPluginTails();
        const newer = refreshExternalPluginTails();
        newerAnswer.resolve([{ instance_id: 'inst-1', tail_samples: 240_000 }]);
        await newer;
        olderAnswer.resolve([{ instance_id: 'inst-1', tail_samples: 48_000 }]);
        await older;

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('lets the later refresh win when the older one answers first', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const olderAnswer = Promise.withResolvers<PluginTailReading[]>();
        const newerAnswer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(olderAnswer.promise).mockReturnValueOnce(newerAnswer.promise);

        const older = refreshExternalPluginTails();
        const newer = refreshExternalPluginTails();
        olderAnswer.resolve([{ instance_id: 'inst-1', tail_samples: 48_000 }]);
        await older;
        newerAnswer.resolve([{ instance_id: 'inst-1', tail_samples: 240_000 }]);
        await newer;

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('does not overwrite a tail the plugin announced while the read was in flight', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);

        const refresh = refreshExternalPluginTails();
        emitTailChange({ instance_id: 'inst-1', tail_samples: 300_000 });
        answer.resolve([{ instance_id: 'inst-1', tail_samples: 240_000 }]);
        await refresh;

        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('does not give an instance reloaded under the same id the old runtime figure', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        const answer = Promise.withResolvers<PluginTailReading[]>();
        mocks.readPluginTailsRepo.mockReturnValueOnce(answer.promise);

        const refresh = refreshExternalPluginTails();
        await unloadPlugin('inst-1');
        mocks.loadPluginRepo.mockImplementationOnce((_pluginId, instanceId) =>
            Promise.resolve(loadedInstance(instanceId, 50_000))
        );
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        answer.resolve([{ instance_id: 'inst-1', tail_samples: 240_000 }]);
        await refresh;

        expect(tailOf('inst-1')).toBe(50_000);
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
