import { beforeEach, describe, expect, it, vi } from 'vitest';

import { externalPluginTailStore } from '../../../stores/externalPluginTailStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { unloadPlugin } from '../unloadPlugin';

import type { PluginInstance, PluginTailChange } from '../../../repositories/pluginBridge/types';
import type { unloadPlugin as unloadPluginRepoSignature } from '../../../repositories/pluginBridge/unloadPlugin';

// The tail store across the real activation, tail watcher and unload use cases,
// down to the IPC repository boundary, which is mocked.
const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string) => Promise<PluginInstance>>(),
    unloadPluginRepo: vi.fn<typeof unloadPluginRepoSignature>(),
    subscribeTail: vi.fn<(handler: (change: PluginTailChange) => void) => Promise<() => void>>(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/onPluginTailChanged', () => ({ onPluginTailChanged: mocks.subscribeTail }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));

/** The handler the single live subscription installed; the watcher keeps one per process. */
let nativeTailHandler: ((change: PluginTailChange) => void) | undefined;
mocks.subscribeTail.mockImplementation((handler) => {
    nativeTailHandler = handler;
    return Promise.resolve(() => {});
});

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

describe('external plugin tail store', () => {
    beforeEach(() => {
        clearLoadedExternalPlugins();
        mocks.loadPluginRepo.mockReset();
        mocks.unloadPluginRepo.mockReset();
        mocks.loadPluginRepo.mockImplementation((_pluginId, instanceId) =>
            Promise.resolve(loadedInstance(instanceId, 96_000))
        );
    });

    it('records the tail the load reported, under the loaded instance', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        expect(tailOf('inst-1')).toBe(96_000);
    });

    it('revises the tail when the plugin reports a new one', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000 });

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('keeps a tail the plugin reported while its load was still returning', async () => {
        mocks.loadPluginRepo.mockImplementation((_pluginId, instanceId) => {
            // The host attached the instance and drained its first-block
            // revision before the load's own, older answer came back.
            emitTailChange({ instance_id: instanceId, tail_samples: 240_000 });
            return Promise.resolve(loadedInstance(instanceId, 96_000));
        });

        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        expect(tailOf('inst-1')).toBe(240_000);
    });

    it('seeds no tail reported during a load the graph rebuild superseded', async () => {
        let finishLoad: () => void = () => {};
        mocks.loadPluginRepo.mockImplementation(
            (_pluginId, instanceId) =>
                new Promise((resolve) => {
                    finishLoad = () => resolve(loadedInstance(instanceId, 96_000));
                })
        );
        const activation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1));
        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000 });

        clearLoadedExternalPlugins();
        finishLoad();
        await activation;

        expect(tailOf('inst-1')).toBeUndefined();
    });

    it('records no tail for an instance the process does not hold', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        emitTailChange({ instance_id: 'gone', tail_samples: 240_000 });

        expect(tailOf('gone')).toBeUndefined();
    });

    it('drops the tail when the instance is unloaded', async () => {
        mocks.unloadPluginRepo.mockResolvedValue({ unloadedInstanceIds: ['inst-1'], errors: [], reports: [] });
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        await unloadPlugin('inst-1');

        expect(tailOf('inst-1')).toBeUndefined();
        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000 });
        expect(tailOf('inst-1')).toBeUndefined();
    });

    it('drops every tail when the graph generation ends', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        clearLoadedExternalPlugins();

        expect(tailOf('inst-1')).toBeUndefined();
    });
});
