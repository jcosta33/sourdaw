import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultExternalPluginActivationState,
    externalPluginActivationStore,
} from '../../../stores/externalPluginActivationStore';
import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { unloadPlugin } from '../unloadPlugin';

import type { PluginLatencyChange } from '../../../repositories/pluginBridge/types';

// Integration across the real load + restore use cases (and serializePluginLifecycle)
// down to the IPC repository boundary, which is mocked. Proves that repeated
// activation — exactly what each ensureTrackStrips rebuild does per external device —
// issues load/restore IPC only once per graph generation, and that the native
// latency push reaches the right instance's sink (PH-4).
const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string) => Promise<unknown>>(),
    setPluginStateRepo: vi.fn<(instanceId: string, state: Uint8Array) => Promise<void>>(),
    unloadPluginRepo: vi.fn<(instanceId: string) => Promise<[string[], string[]]>>(),
    subscribe: vi.fn<(handler: (change: PluginLatencyChange) => void) => Promise<() => void>>(),
    warn: vi.fn(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginStateRepo }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/onPluginLatencyChanged', () => ({
    onPluginLatencyChanged: mocks.subscribe,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));

/**
 * The handler the single live subscription installed. Captured rather than
 * re-created per test because `watchExternalPluginLatency` keeps one
 * process-wide subscription — the same property the last test asserts.
 */
let nativeLatencyHandler: ((change: PluginLatencyChange) => void) | undefined;

/** Total subscriptions across this file. Not a vi.fn count, so clearAllMocks
 * cannot hide a second subscription from the final assertion. */
let subscribeCount = 0;

mocks.subscribe.mockImplementation((handler) => {
    nativeLatencyHandler = handler;
    subscribeCount += 1;
    return Promise.resolve(() => {});
});

/** Play back a `plugin-latency-changed` push from the native host. */
function emitLatencyChange(change: PluginLatencyChange): void {
    if (!nativeLatencyHandler) {
        throw new Error('no native latency subscription is live');
    }
    nativeLatencyHandler(change);
}

// base64 'c2F2ZWQ=' decodes to the bytes of "saved".
const SAVED_CHUNK = 'c2F2ZWQ=';
const SAVED_BYTES = new Uint8Array([115, 97, 118, 101, 100]);

describe('activateExternalPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
        mocks.loadPluginRepo.mockResolvedValue({ instance_id: 'inst-1' });
        mocks.setPluginStateRepo.mockResolvedValue(undefined);
        mocks.unloadPluginRepo.mockResolvedValue([[], []]);
    });

    it('loads and restores exactly once across repeated activations (repeated ensureTrackStrips)', async () => {
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', stateChunk: SAVED_CHUNK });
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', stateChunk: SAVED_CHUNK });
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', stateChunk: SAVED_CHUNK });

        await vi.waitFor(() => expect(mocks.setPluginStateRepo).toHaveBeenCalledTimes(1));

        expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1);
        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p', 'inst-1');
        expect(mocks.setPluginStateRepo).toHaveBeenCalledTimes(1);
        expect(mocks.setPluginStateRepo).toHaveBeenCalledWith('inst-1', SAVED_BYTES);
        expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toEqual({ status: 'active' });
    });

    it('marks the instance live synchronously so a same-tick second call is skipped', async () => {
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1' });

        // The guard is set synchronously, so an immediate second call is skipped
        // before the first even reaches the (async) load IPC.
        expect(loadedExternalInstances.has('inst-1')).toBe(true);
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1' });

        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1));
        expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(1);
    });

    it('re-activates after the graph is torn down (clearLoadedExternalPlugins)', async () => {
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', stateChunk: SAVED_CHUNK });
        await vi.waitFor(() => expect(mocks.setPluginStateRepo).toHaveBeenCalledTimes(1));

        clearLoadedExternalPlugins();
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', stateChunk: SAVED_CHUNK });

        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(2));
    });

    it('drops the guard and retries when instantiation fails', async () => {
        mocks.loadPluginRepo.mockRejectedValueOnce(new Error('boom'));

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1' });
        await vi.waitFor(() => expect(loadedExternalInstances.has('inst-1')).toBe(false));

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1' });
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(2));
        expect(loadedExternalInstances.has('inst-1')).toBe(true);
    });

    // Regression (F14): loading with no engine running returns success with a
    // null engine id, and that used to reach the app as an ordinary active
    // plugin — one that silently processes nothing.
    it('records the degraded state when the plugin loaded with no engine attached', async () => {
        mocks.loadPluginRepo.mockResolvedValueOnce({
            instance_id: 'inst-1',
            latency_samples: 0,
            latency_ms: 0,
            engine_plugin_id: null,
        });

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1' });

        await vi.waitFor(() =>
            expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toEqual({
                status: 'active',
                message: 'Loaded without a running native engine — this plugin processes no audio yet.',
            })
        );
        // Degraded, not failed: the instance stays live so the legitimate
        // load-before-engine-start flow is not retried into a duplicate load.
        expect(loadedExternalInstances.has('inst-1')).toBe(true);
        expect(mocks.warn).toHaveBeenCalledTimes(1);
    });

    it('leaves the activation entry unqualified when the plugin is engine-attached', async () => {
        mocks.loadPluginRepo.mockResolvedValueOnce({
            instance_id: 'inst-1',
            latency_samples: 0,
            latency_ms: 0,
            engine_plugin_id: 1000,
        });

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1' });

        await vi.waitFor(() =>
            expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toEqual({ status: 'active' })
        );
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('publishes an error state when native activation fails', async () => {
        mocks.loadPluginRepo.mockRejectedValueOnce(new Error('unsupported plugin format'));

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1' });

        await vi.waitFor(() =>
            expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toEqual({
                status: 'error',
                message: 'Error: unsupported plugin format',
            })
        );
    });

    it('reports the activation latency in milliseconds to the injected sink', async () => {
        // The host already converted at the plugin's activation rate; the raw
        // sample count on the same DTO must not be what reaches the sink.
        mocks.loadPluginRepo.mockResolvedValueOnce({
            instance_id: 'inst-1',
            latency_samples: 256,
            latency_ms: 5.333_333_333_333_333,
        });
        const onLatencyMs = vi.fn<(latencyMs: number) => void>();

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', onLatencyMs });

        await vi.waitFor(() => expect(onLatencyMs).toHaveBeenCalledWith(5.333_333_333_333_333));
        expect(onLatencyMs).toHaveBeenCalledTimes(1);
    });

    it('routes a mid-session latency change from the native host to the sink', async () => {
        mocks.loadPluginRepo.mockResolvedValueOnce({
            instance_id: 'inst-1',
            latency_samples: 0,
            latency_ms: 0,
        });
        const onLatencyMs = vi.fn<(latencyMs: number) => void>();

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', onLatencyMs });
        await vi.waitFor(() => expect(onLatencyMs).toHaveBeenCalledWith(0));

        // The plugin flips its latency mid-session (oversampling on): the host
        // re-queries and pushes plugin-latency-changed.
        emitLatencyChange({ instance_id: 'inst-1', latency_ms: 21.5 });

        expect(onLatencyMs).toHaveBeenLastCalledWith(21.5);
        expect(onLatencyMs).toHaveBeenCalledTimes(2);

        // A second, independent change must land too — the subscription is not
        // one-shot, and a restart that arrives while the host is still settling
        // the previous one still ends up here.
        emitLatencyChange({ instance_id: 'inst-1', latency_ms: 3 });

        expect(onLatencyMs).toHaveBeenLastCalledWith(3);
        expect(onLatencyMs).toHaveBeenCalledTimes(3);
    });

    it('routes each change only to the instance that reported it', async () => {
        mocks.loadPluginRepo.mockResolvedValue({ instance_id: 'ignored', latency_samples: 0, latency_ms: 0 });
        const firstSink = vi.fn<(latencyMs: number) => void>();
        const secondSink = vi.fn<(latencyMs: number) => void>();

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', onLatencyMs: firstSink });
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-2', onLatencyMs: secondSink });
        await vi.waitFor(() => expect(secondSink).toHaveBeenCalledWith(0));

        emitLatencyChange({ instance_id: 'inst-2', latency_ms: 8 });

        expect(secondSink).toHaveBeenLastCalledWith(8);
        expect(firstSink).toHaveBeenCalledTimes(1);
        expect(firstSink).toHaveBeenLastCalledWith(0);
    });

    it('stops routing changes for an unloaded instance', async () => {
        mocks.loadPluginRepo.mockResolvedValueOnce({ instance_id: 'inst-1', latency_samples: 0, latency_ms: 4 });
        mocks.unloadPluginRepo.mockResolvedValue([['inst-1'], []]);
        const onLatencyMs = vi.fn<(latencyMs: number) => void>();

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', onLatencyMs });
        await vi.waitFor(() => expect(onLatencyMs).toHaveBeenCalledWith(4));

        await unloadPlugin('inst-1');
        emitLatencyChange({ instance_id: 'inst-1', latency_ms: 99 });

        expect(externalPluginActivationStore.value?.byInstanceId['inst-1']).toBeUndefined();
        expect(onLatencyMs).toHaveBeenCalledTimes(1);
        expect(onLatencyMs).not.toHaveBeenCalledWith(99);
    });

    it('subscribes to the native push exactly once across every activation in this file', async () => {
        mocks.loadPluginRepo.mockResolvedValue({ instance_id: 'ignored', latency_samples: 0, latency_ms: 0 });

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', onLatencyMs: vi.fn() });
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-2', onLatencyMs: vi.fn() });
        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-3', onLatencyMs: vi.fn() });
        await vi.waitFor(() => expect(mocks.loadPluginRepo).toHaveBeenCalledTimes(3));

        // The Tauri event is a broadcast: one listener per instance would hand
        // every listener every other plugin's changes. Counted outside vi.fn so
        // per-test clearAllMocks cannot hide an extra subscription.
        expect(subscribeCount).toBe(1);
    });

    it('does not report latency when instantiation fails', async () => {
        mocks.loadPluginRepo.mockRejectedValueOnce(new Error('boom'));
        const onLatencyMs = vi.fn<(latencyMs: number) => void>();

        activateExternalPlugin({ pluginId: 'p', instanceId: 'inst-1', onLatencyMs });

        await vi.waitFor(() => expect(loadedExternalInstances.has('inst-1')).toBe(false));
        expect(onLatencyMs).not.toHaveBeenCalled();

        // The failed instance's sink is gone too, so a stray push cannot revive it.
        emitLatencyChange({ instance_id: 'inst-1', latency_ms: 30 });
        expect(onLatencyMs).not.toHaveBeenCalled();
    });
});
