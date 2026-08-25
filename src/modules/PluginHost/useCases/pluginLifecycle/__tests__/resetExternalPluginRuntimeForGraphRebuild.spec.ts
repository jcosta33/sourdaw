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
});
