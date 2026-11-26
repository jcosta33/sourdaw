import { beforeEach, describe, expect, it, vi } from 'vitest';

import { externalPluginActivationStore } from '../../../stores/externalPluginActivationStore';
import { externalPluginTailStore } from '../../../stores/externalPluginTailStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { forgetRetiredPluginInstances } from '../forgetRetiredPluginInstances';
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

/** The host numbers every event; each one emitted here is later than the one before. */
let lastSequence = 0;

function emitTailChange(change: Omit<PluginTailChange, 'sequence'>): void {
    if (!nativeTailHandler) {
        throw new Error('no native tail subscription is live');
    }
    lastSequence += 1;
    nativeTailHandler({ ...change, sequence: lastSequence });
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
        tail_sequence: 0,
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

    it('ignores a tail held during a load whose native sequence the load answer outranks', async () => {
        const load = Promise.withResolvers<PluginInstance>();
        mocks.loadPluginRepo.mockReturnValueOnce(load.promise);
        const activation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1));
        // Numbered by the host before the load read its own figure, delivered before the answer.
        nativeTailHandler?.({ instance_id: 'inst-1', tail_samples: 240_000, sequence: 2 });

        load.resolve({ ...loadedInstance('inst-1', 96_000), tail_sequence: 5 });
        await activation;

        expect(tailOf('inst-1')).toBe(96_000);
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

    /**
     * Holds a 240000 revision for `inst-1` against a first load that has not
     * returned yet, and hands back the way to let that load return 96000.
     */
    async function holdRevisionDuringLoad(): Promise<{ finishFirstLoad: () => Promise<unknown> }> {
        let resolveFirstLoad: (instance: PluginInstance) => void = () => {};
        mocks.loadPluginRepo.mockImplementationOnce(
            () =>
                new Promise<PluginInstance>((resolve) => {
                    resolveFirstLoad = resolve;
                })
        );
        const firstActivation = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1));
        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000 });
        return {
            finishFirstLoad: () => {
                resolveFirstLoad(loadedInstance('inst-1', 96_000));
                return firstActivation;
            },
        };
    }

    it('discards the tail from an in-flight load when the engine retires its instance', async () => {
        const { finishFirstLoad } = await holdRevisionDuringLoad();

        // An engine retire forgets the instance without waiting for its load,
        // which unload's lifecycle queue would.
        forgetRetiredPluginInstances(['inst-1']);
        await finishFirstLoad();

        expect(tailOf('inst-1')).toBeUndefined();
    });

    it('preserves an in-flight tail revision for a successor reusing a retired instance ID', async () => {
        const oldLoad = Promise.withResolvers<PluginInstance>();
        const successorLoad = Promise.withResolvers<PluginInstance>();
        mocks.loadPluginRepo.mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(successorLoad.promise);

        const retired = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1));
        forgetRetiredPluginInstances(['inst-1']);
        const successor = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        oldLoad.resolve(loadedInstance('inst-1', 48_000));
        await retired;
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(2));
        const tailAfterRetiredLoad = tailOf('inst-1');
        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000 });
        const tailDuringSuccessorLoad = tailOf('inst-1');
        successorLoad.resolve(loadedInstance('inst-1', 96_000));
        await successor;

        expect(tailOf('inst-1')).toBe(240_000);
        expect(tailAfterRetiredLoad).toBeUndefined();
        expect(tailDuringSuccessorLoad).toBeUndefined();
    });

    it('preserves the successor when a retired load rejects', async () => {
        const oldLoad = Promise.withResolvers<PluginInstance>();
        const successorLoad = Promise.withResolvers<PluginInstance>();
        mocks.loadPluginRepo.mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(successorLoad.promise);

        const retired = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1));
        forgetRetiredPluginInstances(['inst-1']);
        const successor = activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        oldLoad.reject(new Error('retired load failed'));
        const retiredOutcome = await retired;
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(2));
        const successorStatus = externalPluginActivationStore.value?.byInstanceId['inst-1'];
        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000 });
        successorLoad.resolve(loadedInstance('inst-1', 96_000));
        const successorOutcome = await successor;

        expect(retiredOutcome).toEqual({
            status: 'failed',
            stage: 'load',
            reason: 'Error: retired load failed',
        });
        expect(tailOf('inst-1')).toBe(240_000);
        expect(successorStatus).toEqual({ status: 'loading' });
        expect(successorOutcome).toEqual({ status: 'active' });
    });

    it('seeds a reactivation from its own load once the graph generation ended', async () => {
        const { finishFirstLoad } = await holdRevisionDuringLoad();

        clearLoadedExternalPlugins();
        await finishFirstLoad();
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(2);
        expect(tailOf('inst-1')).toBe(96_000);
    });

    it('records no tail for an instance the process does not hold', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        emitTailChange({ instance_id: 'gone', tail_samples: 240_000 });

        expect(tailOf('gone')).toBeUndefined();
        // Not held for a load either: a later load of that id seeds its own figure.
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'gone' });
        expect(tailOf('gone')).toBe(96_000);
    });

    it('subscribes again on the next activation when subscribing failed', async () => {
        // The watcher keeps one subscription per process, so this case needs a
        // watcher that has not subscribed yet; it restores the shared handler
        // the other cases emit through.
        const sharedHandler = nativeTailHandler;
        vi.resetModules();
        try {
            const fresh = await import('../activateExternalPlugin');
            const freshTails = await import('../../../stores/externalPluginTailStore');
            mocks.subscribeTail.mockClear();
            mocks.subscribeTail.mockRejectedValueOnce(new Error('desktop bridge unavailable'));

            await fresh.activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
            await fresh.activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-2' });

            expect(mocks.subscribeTail).toHaveBeenCalledTimes(2);
            emitTailChange({ instance_id: 'inst-2', tail_samples: 240_000 });
            expect(freshTails.externalPluginTailStore.value?.tailSamplesByInstanceId['inst-2']).toBe(240_000);
        } finally {
            nativeTailHandler = sharedHandler;
        }
    });

    it('drops the tail when the instance is unloaded', async () => {
        mocks.unloadPluginRepo.mockResolvedValue({ unloadedInstanceIds: ['inst-1'], errors: [], reports: [] });
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        await unloadPlugin('inst-1');

        expect(tailOf('inst-1')).toBeUndefined();
        emitTailChange({ instance_id: 'inst-1', tail_samples: 240_000 });
        expect(tailOf('inst-1')).toBeUndefined();
    });

    it('ignores an event the predecessor of the same instance id published before the successor load read', async () => {
        mocks.unloadPluginRepo.mockResolvedValue({ unloadedInstanceIds: ['inst-1'], errors: [], reports: [] });
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });
        await unloadPlugin('inst-1');
        const predecessorEventSequence = lastSequence + 1;
        mocks.loadPluginRepo.mockImplementation((_pluginId, instanceId) =>
            Promise.resolve({
                ...loadedInstance(instanceId, 50_000),
                tail_sequence: predecessorEventSequence + 1,
            })
        );
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        // Delivered late: numbered by the host before the successor's load read.
        nativeTailHandler?.({ instance_id: 'inst-1', tail_samples: 240_000, sequence: predecessorEventSequence });
        expect(tailOf('inst-1')).toBe(50_000);

        nativeTailHandler?.({ instance_id: 'inst-1', tail_samples: 300_000, sequence: predecessorEventSequence + 2 });
        expect(tailOf('inst-1')).toBe(300_000);
    });

    it('drops every tail when the graph generation ends', async () => {
        await activateExternalPlugin({ pluginId: 'reverb', instanceId: 'inst-1' });

        clearLoadedExternalPlugins();

        expect(tailOf('inst-1')).toBeUndefined();
    });
});
