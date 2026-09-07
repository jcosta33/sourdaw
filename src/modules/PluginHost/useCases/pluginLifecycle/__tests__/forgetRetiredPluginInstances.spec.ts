/**
 * What a native engine retire leaves behind, from this process's side (#3960).
 *
 * The observable is the load repository: `activateExternalPlugin`
 * short-circuits on `loadedExternalInstances`, so an instance the retire
 * destroyed is reloaded only if this use case actually dropped that record. The
 * IPC repositories are the doubled boundary, exactly as in
 * `activateExternalPlugin.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { forgetRetiredPluginInstances } from '../forgetRetiredPluginInstances';
import { loadedExternalInstances } from '../loadedExternalInstances';

import type { PluginLatencyChange } from '../../../repositories/pluginBridge/types';

const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string, sampleRate: number) => Promise<unknown>>(),
    setPluginStateRepo: vi.fn<(instanceId: string, state: Uint8Array) => Promise<void>>(),
    subscribe: vi.fn<(handler: (change: PluginLatencyChange) => void) => Promise<() => void>>(),
    warn: vi.fn(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginStateRepo }));
vi.mock('../../../repositories/pluginBridge/onPluginLatencyChanged', () => ({
    onPluginLatencyChanged: mocks.subscribe,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));

const ENGINE_SAMPLE_RATE = 48_000;

function load(instanceId: string): Promise<unknown> {
    return activateExternalPlugin({ engineSampleRate: ENGINE_SAMPLE_RATE, pluginId: 'p', instanceId });
}

describe('forgetRetiredPluginInstances', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
        mocks.loadPluginRepo.mockResolvedValue({ instance_id: 'inst-1', parameters: [], latency_ms: 0 });
        mocks.setPluginStateRepo.mockResolvedValue(undefined);
        mocks.subscribe.mockResolvedValue(() => {});
    });

    it('lets the next activation reload an instance the retire destroyed', async () => {
        await load('inst-1');
        expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1);

        forgetRetiredPluginInstances(['inst-1']);

        expect(loadedExternalInstances.has('inst-1')).toBe(false);
        expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toBeUndefined();

        await load('inst-1');

        expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(2);
    });

    it('ignores an id this process never loaded, and leaves the ones it did alone', async () => {
        await load('inst-1');

        forgetRetiredPluginInstances(['inst-absent']);

        expect(loadedExternalInstances.has('inst-1')).toBe(true);
        expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toEqual({ status: 'active' });

        await load('inst-1');

        expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1);
    });
});
