import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { externalLatencyReporters } from '../externalLatencyReporters';
import { externalPluginActivationOutcomes, externalPluginActivationTasks } from '../externalPluginActivationTasks';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { resetExternalPluginRuntimeForGraphRebuild } from '../resetExternalPluginRuntimeForGraphRebuild';
import { unloadPlugin } from '../unloadPlugin';

const mocks = vi.hoisted(() => ({
    loadPlugin: vi.fn(),
    unloadPlugin: vi.fn(),
}));

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
            latency_samples: 0,
            latency_ms: 4,
            engine_plugin_id: 1000,
        });
        mocks.unloadPlugin.mockResolvedValue([['plugin-instance-1'], []]);
    });

    it('invalidates the full lifecycle generation so an already-loaded plugin is reattached', async () => {
        const latencyReporter = vi.fn();
        await expect(
            activateExternalPlugin({
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
            activateExternalPlugin({ pluginId: 'compressor', instanceId: 'plugin-instance-1' })
        ).resolves.toEqual({ status: 'active' });
        expect(mocks.unloadPlugin).toHaveBeenCalledOnce();
        expect(mocks.loadPlugin).toHaveBeenCalledTimes(2);
    });

    it('fences activation admitted during rebuild until bulk unload has completed', async () => {
        const firstLoad = Promise.withResolvers<{
            instance_id: string;
            latency_samples: number;
            latency_ms: number;
            engine_plugin_id: number;
        }>();
        const bulkUnload = Promise.withResolvers<[string[], string[]]>();
        mocks.loadPlugin.mockReturnValueOnce(firstLoad.promise).mockResolvedValueOnce({
            instance_id: 'late-instance',
            latency_samples: 0,
            latency_ms: 2,
            engine_plugin_id: 1001,
        });
        mocks.unloadPlugin.mockReturnValueOnce(bulkUnload.promise);

        const firstActivation = activateExternalPlugin({
            pluginId: 'compressor',
            instanceId: 'plugin-instance-1',
        });
        await vi.waitFor(() => expect(mocks.loadPlugin).toHaveBeenCalledOnce());
        const reset = resetExternalPluginRuntimeForGraphRebuild();
        const lateActivation = activateExternalPlugin({
            pluginId: 'compressor',
            instanceId: 'late-instance',
        });

        firstLoad.resolve({
            instance_id: 'plugin-instance-1',
            latency_samples: 0,
            latency_ms: 4,
            engine_plugin_id: 1000,
        });
        await firstActivation;
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledOnce());
        bulkUnload.resolve([['plugin-instance-1'], []]);
        await Promise.all([reset, lateActivation]);

        expect(mocks.unloadPlugin.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.loadPlugin.mock.invocationCallOrder[1]!
        );
        expect(loadedExternalInstances.has('late-instance')).toBe(true);
    });

    it('serializes bulk unload after an already admitted keyed lifecycle operation', async () => {
        loadedExternalInstances.add('plugin-instance-1');
        const keyedUnload = Promise.withResolvers<[string[], string[]]>();
        const bulkUnload = Promise.withResolvers<[string[], string[]]>();
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
        keyedUnload.resolve([['plugin-instance-1'], []]);
        await keyed;
        await vi.waitFor(() => expect(mocks.unloadPlugin).toHaveBeenCalledWith());
        bulkUnload.resolve([[], []]);
        await reset;

        expect(bulkObservedSettledKeyedUnload).toBe(true);
    });
});
