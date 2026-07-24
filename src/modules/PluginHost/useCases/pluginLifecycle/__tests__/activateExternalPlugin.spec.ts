import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activateExternalPlugin } from '../activateExternalPlugin';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { loadedExternalInstances } from '../loadedExternalInstances';

// Integration across the real load + restore use cases (and serializePluginLifecycle)
// down to the IPC repository boundary, which is mocked. Proves that repeated
// activation — exactly what each ensureTrackStrips rebuild does per external device —
// issues load/restore IPC only once per graph generation.
const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn<(pluginId: string, instanceId: string) => Promise<unknown>>(),
    setPluginStateRepo: vi.fn<(instanceId: string, state: number[]) => Promise<void>>(),
    warn: vi.fn(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPluginRepo }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginStateRepo }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));

// base64 'c2F2ZWQ=' decodes to the bytes of "saved".
const SAVED_CHUNK = 'c2F2ZWQ=';
const SAVED_BYTES = [115, 97, 118, 101, 100];

describe('activateExternalPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        mocks.loadPluginRepo.mockResolvedValue({ instance_id: 'inst-1' });
        mocks.setPluginStateRepo.mockResolvedValue(undefined);
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
});
