import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type PluginInstance } from '../../../repositories/pluginBridge/types';
import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { beginProjectSessionPluginRetirement } from '../beginProjectSessionPluginRetirement';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { externalLatencyReporters } from '../externalLatencyReporters';
import { externalPluginActivationOutcomes, externalPluginActivationTasks } from '../externalPluginActivationTasks';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { resetExternalPluginRuntimeForGraphRebuild } from '../resetExternalPluginRuntimeForGraphRebuild';
import { unloadPlugin } from '../unloadPlugin';

import type { unloadPlugin as unloadPluginRepoSignature } from '../../../repositories/pluginBridge/unloadPlugin';

const mocks = vi.hoisted(() => ({
    loadPlugin: vi.fn(),
    unloadPlugin: vi.fn<typeof unloadPluginRepoSignature>(),
}));

/** The repository's own reply shape, for tests settling a deferred unload by hand. */
type UnloadReply = Awaited<ReturnType<typeof unloadPluginRepoSignature>>;

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPlugin }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPlugin }));
vi.mock('../../../repositories/pluginBridge/onPluginLatencyChanged', () => ({
    onPluginLatencyChanged: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));

describe('resetExternalPluginRuntimeForGraphRebuild', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
        mocks.loadPlugin.mockResolvedValue({
            instance_id: 'plugin-instance-1',
            parameters: [],
            latency_samples: 0,
            latency_ms: 4,
            engine_plugin_id: 1000,
        });
        mocks.unloadPlugin.mockResolvedValue({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
    });

    it('invalidates the full lifecycle generation so an already-loaded plugin is reattached', async () => {
        const latencyReporter = vi.fn();
        await expect(
            activateExternalPlugin({
                engineSampleRate: 48_000,
                pluginId: 'compressor',
                instanceId: 'plugin-instance-1',
                onLatencyMs: latencyReporter,
            })
        ).resolves.toEqual({ status: 'active' });

        expect(loadedExternalInstances.has('plugin-instance-1')).toBe(true);
        expect(externalPluginActivationOutcomes.has('plugin-instance-1')).toBe(true);
        expect(externalLatencyReporters.has('plugin-instance-1')).toBe(true);

        await resetExternalPluginRuntimeForGraphRebuild();

        expect(loadedExternalInstances.size).toBe(0);
        expect(externalPluginActivationTasks.size).toBe(0);
        expect(externalPluginActivationOutcomes.size).toBe(0);
        expect(externalLatencyReporters.size).toBe(0);
        expect(externalPluginActivationStore.value).toEqual(defaultExternalPluginActivationState);

        await expect(
            activateExternalPlugin({
                engineSampleRate: 48_000,
                pluginId: 'compressor',
                instanceId: 'plugin-instance-1',
            })
        ).resolves.toEqual({ status: 'active' });
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();
        expect(mocks.loadPlugin).toHaveBeenCalledTimes(2);
    });

    it('fences activation admitted during rebuild until bulk unload has completed', async () => {
        // Derived from the production load result rather than restated, so a
        // field the host starts returning — `parameters` was the last one —
        // cannot leave this fixture describing a shape nothing produces.
        const firstLoad =
            Promise.withResolvers<
                Pick<
                    PluginInstance,
                    'instance_id' | 'parameters' | 'latency_samples' | 'latency_ms' | 'engine_plugin_id'
                >
            >();
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        mocks.loadPlugin.mockReturnValueOnce(firstLoad.promise).mockResolvedValueOnce({
            instance_id: 'late-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 2,
            engine_plugin_id: 1001,
        });
        mocks.unloadPlugin.mockReturnValueOnce(bulkUnload.promise);

        const firstActivation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'plugin-instance-1',
        });
        await vi.waitFor(() => expect(mocks.loadPlugin).toHaveBeenCalledOnce());
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        const lateActivation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'late-instance',
        });

        firstLoad.resolve({
            instance_id: 'plugin-instance-1',
            parameters: [],
            latency_samples: 0,
            latency_ms: 4,
            engine_plugin_id: 1000,
        });
        await firstActivation;
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        bulkUnload.resolve({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
        await Promise.all([reset, lateActivation]);

        expect(mocks.unloadPlugin.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadPlugin.mock.invocationCallOrder[1]!
        );
        expect(loadedExternalInstances.has('late-instance')).toBe(true);
    });

    it('keeps activation admission fenced through project-session bulk retirement until the reused host reopens', async () => {
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        mocks.unloadPlugin.mockReturnValueOnce(bulkUnload.promise);
        mocks.loadPlugin.mockResolvedValueOnce({
            instance_id: 'late-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 2,
            engine_plugin_id: 1001,
        });
        const retirement = await beginProjectSessionPluginRetirement();
        const retiring = retirement.retire();
        const activation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'late-instance',
        });

        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        expect(mocks.loadPlugin).not.toHaveBeenCalled();
        bulkUnload.resolve({ unloadedInstanceIds: [], errors: [], reports: [] });
        await retiring;
        expect(mocks.loadPlugin).not.toHaveBeenCalled();

        retirement.reopen();
        await activation;
        expect(mocks.loadPlugin).toHaveBeenCalledOnce();
    });

    it('keeps project-session activation fenced when native bulk retirement rejects', async () => {
        mocks.unloadPlugin.mockRejectedValueOnce(new Error('native unload failed'));
        const retirement = await beginProjectSessionPluginRetirement();

        await expect(retirement.retire()).rejects.toThrow('native unload failed');
        const activation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'after-failed-retirement',
        });
        await Promise.resolve();
        expect(mocks.loadPlugin).not.toHaveBeenCalled();

        retirement.reopen();
        await activation;
        expect(mocks.loadPlugin).toHaveBeenCalledOnce();
    });

    it('waits for a pre-admitted activation before bulk retirement and leaves no late instance behind', async () => {
        const admittedLoad =
            Promise.withResolvers<
                Pick<
                    PluginInstance,
                    'instance_id' | 'parameters' | 'latency_samples' | 'latency_ms' | 'engine_plugin_id'
                >
            >();
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        mocks.loadPlugin.mockReturnValueOnce(admittedLoad.promise);
        mocks.unloadPlugin.mockReturnValueOnce(bulkUnload.promise);

        const activation = activateExternalPlugin({
            engineSampleRate: 48_000,
            pluginId: 'compressor',
            instanceId: 'pre-admitted-instance',
        });
        await vi.waitFor(() => expect(mocks.loadPlugin).toHaveBeenCalledOnce());

        const retirement = await beginProjectSessionPluginRetirement();
        const retiring = retirement.retire();
        await Promise.resolve();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();

        admittedLoad.resolve({
            instance_id: 'pre-admitted-instance',
            parameters: [],
            latency_samples: 0,
            latency_ms: 3,
            engine_plugin_id: 1002,
        });
        await expect(activation).resolves.toMatchObject({ status: 'failed', stage: 'attach' });
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        bulkUnload.resolve({ unloadedInstanceIds: ['pre-admitted-instance'], errors: [], reports: [] });
        await retiring;

        expect(loadedExternalInstances.has('pre-admitted-instance')).toBe(false);
        expect(externalPluginActivationTasks.has('pre-admitted-instance')).toBe(false);
        expect(externalPluginActivationOutcomes.has('pre-admitted-instance')).toBe(false);
        retirement.reopen();
    });

    it('waits for an already-active rebuild before acquiring the project-session retirement fence', async () => {
        const activeUnload = Promise.withResolvers<UnloadReply>();
        mocks.unloadPlugin.mockReturnValueOnce(activeUnload.promise);
        const activeRebuild = resetExternalPluginRuntimeForGraphRebuild();
        const retirement = beginProjectSessionPluginRetirement();

        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        let retirementAcquired = false;
        void retirement.then(() => {
            retirementAcquired = true;
        });
        await Promise.resolve();
        expect(retirementAcquired).toBe(false);
        // The session fence cannot begin its own bulk unload while the active
        // graph rebuild still owns the lifecycle fence.
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();

        activeUnload.resolve({ unloadedInstanceIds: [], errors: [], reports: [] });
        await activeRebuild;
        const sessionRetirement = await retirement;
        await sessionRetirement.retire();
        sessionRetirement.reopen();

        expect(mocks.unloadPlugin).toHaveBeenCalledTimes(2);
    });

    it('serializes bulk unload after an already admitted keyed lifecycle operation', async () => {
        loadedExternalInstances.add('plugin-instance-1');
        const keyedUnload = Promise.withResolvers<UnloadReply>();
        const bulkUnload = Promise.withResolvers<UnloadReply>();
        let keyedUnloadSettled = false;
        let bulkObservedSettledKeyedUnload = false;
        void keyedUnload.promise.then(() => {
            keyedUnloadSettled = true;
        });
        mocks.unloadPlugin.mockImplementation((instanceId?: string) => {
            if (instanceId) {
                return keyedUnload.promise;
            }
            bulkObservedSettledKeyedUnload = keyedUnloadSettled;
            return bulkUnload.promise;
        });

        const keyed = unloadPlugin('plugin-instance-1');
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith('plugin-instance-1'));
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        keyedUnload.resolve({ unloadedInstanceIds: ['plugin-instance-1'], errors: [], reports: [] });
        await keyed;
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith(undefined));
        bulkUnload.resolve({ unloadedInstanceIds: [], errors: [], reports: [] });
        await reset;

        expect(bulkObservedSettledKeyedUnload).toBe(true);
    });
});
