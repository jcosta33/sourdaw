import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    loadPlugin: vi.fn(),
    setPluginState: vi.fn<(instanceId: string, state: Uint8Array) => Promise<void>>(),
    unloadPlugin: vi.fn(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({ loadPlugin: mocks.loadPlugin }));
vi.mock('../../../repositories/pluginBridge/setPluginState', () => ({ setPluginState: mocks.setPluginState }));
vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadPlugin }));

import { beginProjectSessionPluginRetirement } from '../beginProjectSessionPluginRetirement';
import { clearExternalPluginRestoreFailure } from '../clearExternalPluginRestoreFailure';
import { clearLoadedExternalPlugins } from '../clearLoadedExternalPlugins';
import { externalPluginStateCaptureAuthority } from '../externalPluginStateCaptureAuthority';
import { forgetRetiredPluginInstances } from '../forgetRetiredPluginInstances';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { loadPlugin } from '../loadPlugin';
import { markExternalPluginRestoreFailure } from '../markExternalPluginRestoreFailure';
import { resetExternalPluginRuntimeForGraphRebuild } from '../resetExternalPluginRuntimeForGraphRebuild';
import { restorePluginState } from '../restorePluginState';
import { unloadPlugin } from '../unloadPlugin';

function unloaded(instanceIds: string[] = []) {
    return { unloadedInstanceIds: instanceIds, errors: [], reports: [] };
}

describe('external plugin state capture authority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        externalPluginStateCaptureAuthority.invalidateAll();
        mocks.loadPlugin.mockResolvedValue({
            instance_id: 'instance',
            plugin_id: 'plugin',
            name: 'Plugin',
            parameters: [],
            is_active: true,
            latency_samples: 0,
            latency_ms: 0,
            tail_samples: 0,
            engine_plugin_id: 1,
        });
        mocks.setPluginState.mockResolvedValue(undefined);
        mocks.unloadPlugin.mockResolvedValue(unloaded());
    });

    it('keeps one opaque token stable until that instance is invalidated', () => {
        const token = externalPluginStateCaptureAuthority.current('instance-a');

        expect(externalPluginStateCaptureAuthority.current('instance-a')).toBe(token);
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', token)).toBe(true);

        externalPluginStateCaptureAuthority.invalidate('instance-a');

        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', token)).toBe(false);
        expect(externalPluginStateCaptureAuthority.current('instance-a')).not.toBe(token);
    });

    it('invalidates only the named instance until whole-runtime invalidation', () => {
        const alpha = externalPluginStateCaptureAuthority.current('instance-a');
        const beta = externalPluginStateCaptureAuthority.current('instance-b');

        externalPluginStateCaptureAuthority.invalidate('instance-a');
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', alpha)).toBe(false);
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-b', beta)).toBe(true);

        externalPluginStateCaptureAuthority.invalidateAll();
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-b', beta)).toBe(false);
    });

    it('invalidates at load admission and a failed load cannot revive the old token', async () => {
        const token = externalPluginStateCaptureAuthority.current('instance-a');
        mocks.loadPlugin.mockRejectedValueOnce(new Error('load failed'));

        const loading = loadPlugin('plugin', 'instance-a', 48_000);

        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', token)).toBe(false);
        await expect(loading).rejects.toThrow('load failed');
        expect(externalPluginStateCaptureAuthority.current('instance-a')).not.toBe(token);
    });

    it('invalidates restore authority at admission even for an empty-state no-op and again at settlement', async () => {
        const beforeAdmission = externalPluginStateCaptureAuthority.current('instance-a');

        await restorePluginState('instance-a', '');

        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', beforeAdmission)).toBe(false);
        const beforeFailure = externalPluginStateCaptureAuthority.current('instance-a');
        markExternalPluginRestoreFailure('instance-a');
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', beforeFailure)).toBe(false);

        const beforeSuccess = externalPluginStateCaptureAuthority.current('instance-a');
        clearExternalPluginRestoreFailure('instance-a');
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', beforeSuccess)).toBe(false);
    });

    it('invalidates keyed unload at admission and never revives the token when unload fails', async () => {
        loadedExternalInstances.add('instance-a');
        const token = externalPluginStateCaptureAuthority.current('instance-a');
        const pending = Promise.withResolvers<ReturnType<typeof unloaded>>();
        mocks.unloadPlugin.mockReturnValueOnce(pending.promise);

        const unloading = unloadPlugin('instance-a');
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', token)).toBe(false);
        pending.reject(new Error('unload failed'));

        await expect(unloading).rejects.toThrow('unload failed');
        expect(externalPluginStateCaptureAuthority.current('instance-a')).not.toBe(token);
    });

    it('invalidates unkeyed unload at admission before native teardown settles', async () => {
        const alpha = externalPluginStateCaptureAuthority.current('instance-a');
        const beta = externalPluginStateCaptureAuthority.current('instance-b');
        const pending = Promise.withResolvers<ReturnType<typeof unloaded>>();
        mocks.unloadPlugin.mockReturnValueOnce(pending.promise);

        const unloading = unloadPlugin();
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', alpha)).toBe(false);
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-b', beta)).toBe(false);
        pending.resolve(unloaded());

        await expect(unloading).resolves.toBeUndefined();
    });

    it('forgets only the named instances retired by the native engine', () => {
        loadedExternalInstances.add('instance-a');
        loadedExternalInstances.add('instance-b');
        const alpha = externalPluginStateCaptureAuthority.current('instance-a');
        const beta = externalPluginStateCaptureAuthority.current('instance-b');

        forgetRetiredPluginInstances(['instance-a']);

        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', alpha)).toBe(false);
        expect(externalPluginStateCaptureAuthority.isCurrent('instance-b', beta)).toBe(true);
    });

    it('invalidates graph-reset authority at admission', async () => {
        const token = externalPluginStateCaptureAuthority.current('instance-a');

        const reset = resetExternalPluginRuntimeForGraphRebuild();

        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', token)).toBe(false);
        await expect(reset).resolves.toBeUndefined();
    });

    it('invalidates session authority as soon as its retirement fence is acquired', async () => {
        const token = externalPluginStateCaptureAuthority.current('instance-a');

        const retirement = await beginProjectSessionPluginRetirement();

        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', token)).toBe(false);
        try {
            await retirement.retire();
        } finally {
            retirement.reopen();
        }
    });

    it('direct whole-runtime clear invalidates all receipts', () => {
        const token = externalPluginStateCaptureAuthority.current('instance-a');

        clearLoadedExternalPlugins();

        expect(externalPluginStateCaptureAuthority.isCurrent('instance-a', token)).toBe(false);
    });
});
