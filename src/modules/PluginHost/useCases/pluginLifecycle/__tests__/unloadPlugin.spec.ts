import { beforeEach, describe, it, expect, vi } from 'vitest';

import { defaultPluginGuiState, pluginGuiStore } from '../../../stores/pluginGuiStore';
import * as subject from '../unloadPlugin';

const mocks = vi.hoisted(() => ({
    unloadRepo: vi.fn<(instanceId?: string) => Promise<[string[], string[]]>>(),
}));

vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({ unloadPlugin: mocks.unloadRepo }));

describe('unloadPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pluginGuiStore.set(defaultPluginGuiState);
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
});
