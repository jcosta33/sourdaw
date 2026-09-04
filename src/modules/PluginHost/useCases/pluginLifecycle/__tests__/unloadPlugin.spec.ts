import { beforeEach, describe, it, expect, vi } from 'vitest';

import {
    defaultExternalPluginParameterState,
    externalPluginParameterStore,
} from '../../../stores/externalPluginParameterStore';
import { defaultPluginGuiState, pluginGuiStore } from '../../../stores/pluginGuiStore';
import { loadedExternalInstances } from '../loadedExternalInstances';
import * as subject from '../unloadPlugin';

const mocks = vi.hoisted(() => ({
    unloadRepo: vi.fn<(instanceId?: string) => Promise<[string[], string[]]>>(),
}));

/** One parameter, so a retraction that dropped the list instead would show. */
const PARAMETER = {
    id: 7,
    name: 'Mix',
    value: 0.5,
    defaultValue: 0.5,
    minValue: 0,
    maxValue: 1,
    unit: '%',
    isAutomatable: true,
};

vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadRepo }));

describe('unloadPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pluginGuiStore.set(defaultPluginGuiState);
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
        loadedExternalInstances.clear();
    });

    it('should export unloadPlugin', () => {
        expect(subject.unloadPlugin).toBeDefined();
        const time = typeof subject.unloadPlugin;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    /**
     * Unloading destroys the editor window outright — the OS never reports that
     * close, so the `plugin-gui-closed` event that retracts every other open
     * editor never arrives for this one. Left behind, the record says an
     * instance that no longer exists has an editor on screen, and it says so for
     * the rest of the session.
     */
    it('forgets the editor state of an instance it unloaded', async () => {
        pluginGuiStore.set({
            byInstanceId: { 'inst-1': { isOpen: true }, 'inst-2': { isOpen: true } },
        });
        mocks.unloadRepo.mockResolvedValue([['inst-1'], []]);

        await subject.unloadPlugin();

        expect(pluginGuiStore.value?.byInstanceId['inst-1']).toBeUndefined();
        // An instance the unload did not name keeps its editor.
        expect(pluginGuiStore.value?.byInstanceId['inst-2']).toEqual({ isOpen: true });
    });

    /**
     * The attach mirror decides whether a live strip may claim a native body for
     * an external plugin, and the native mapper refuses the *whole batch* over a
     * device whose instance it cannot find. The unload IPC is not instant, so a
     * play landing while it is in flight reads this store — and reads it after
     * the native side has already dropped the instance.
     */
    it('retracts the attachment before the unload is even awaited', async () => {
        externalPluginParameterStore.set({
            byInstanceId: {
                'inst-1': { engineAttached: true, parameters: [PARAMETER] },
                'inst-2': { engineAttached: true, parameters: [] },
            },
        });
        loadedExternalInstances.add('inst-1');
        let settle = (): void => undefined;
        mocks.unloadRepo.mockReturnValue(
            new Promise<[string[], string[]]>((resolve) => {
                settle = () => resolve([['inst-1'], []]);
            })
        );

        const unloading = subject.unloadPlugin('inst-1');
        await Promise.resolve();

        // In flight: the instance is no longer claimed as attached, and its
        // parameters are still there, because the plugin declared those and the
        // engine says nothing about them.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toEqual({
            engineAttached: false,
            parameters: [PARAMETER],
        });
        // An instance this unload does not name keeps its own attachment.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-2']?.engineAttached).toBe(true);

        settle();
        await unloading;

        // Once it lands the whole snapshot goes: parameters describing an
        // instance that no longer exists would offer automation for a
        // destroyed plugin.
        expect(externalPluginParameterStore.value?.byInstanceId['inst-1']).toBeUndefined();
    });

    it('retracts every attachment before an unkeyed unload is awaited', async () => {
        // The unkeyed unload names no instance because it retires all of them.
        externalPluginParameterStore.set({
            byInstanceId: {
                'inst-1': { engineAttached: true, parameters: [] },
                'inst-2': { engineAttached: true, parameters: [] },
            },
        });
        let settle = (): void => undefined;
        mocks.unloadRepo.mockReturnValue(
            new Promise<[string[], string[]]>((resolve) => {
                settle = () => resolve([[], []]);
            })
        );

        const unloading = subject.unloadPlugin();
        await Promise.resolve();

        expect(
            Object.values(externalPluginParameterStore.value?.byInstanceId ?? {}).map(
                (snapshot) => snapshot.engineAttached
            )
        ).toEqual([false, false]);

        settle();
        await unloading;
    });
});
