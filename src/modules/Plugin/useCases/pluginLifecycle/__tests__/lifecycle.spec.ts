import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadPlugin } from '../loadPlugin';
import { openPluginGui } from '../openPluginGui';
import { unloadPlugin } from '../unloadPlugin';

const mocks = vi.hoisted(() => ({
    loadPluginRepo: vi.fn(),
    unloadPluginRepo: vi.fn(),
    openPluginGuiRepo: vi.fn(),
}));

vi.mock('../../../repositories/pluginBridge/loadPlugin', () => ({
    loadPlugin: mocks.loadPluginRepo,
}));

vi.mock('../../../repositories/pluginBridge/unloadPlugin', () => ({
    unloadPlugin: mocks.unloadPluginRepo,
}));

vi.mock('../../../repositories/pluginBridge/openPluginGui', () => ({
    openPluginGui: mocks.openPluginGuiRepo,
}));

describe('Plugin Lifecycle Use Cases', () => {
    beforeEach(() => vi.clearAllMocks());

    it('loadPlugin delegates to repository', async () => {
        await loadPlugin('p1', 'inst1');
        expect(mocks.loadPluginRepo).toHaveBeenCalledWith('p1', 'inst1');
    });

    it('unloadPlugin delegates to repository', async () => {
        await unloadPlugin('inst1');
        expect(mocks.unloadPluginRepo).toHaveBeenCalledWith('inst1');
    });

    it('openPluginGui delegates to repository', async () => {
        await openPluginGui('inst1');
        expect(mocks.openPluginGuiRepo).toHaveBeenCalledWith('inst1');
    });
});
