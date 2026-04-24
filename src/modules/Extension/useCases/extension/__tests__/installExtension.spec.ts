import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionManifest, type ExtensionMarketplaceState } from '../../../stores/extension';
import { installExtension } from '../installExtension';

const mocks = vi.hoisted(() => ({
    extensionStore: {
        value: null as unknown as ExtensionMarketplaceState,
        set: vi.fn<(state: ExtensionMarketplaceState) => void>(),
    },
}));

vi.mock('../../../stores/extension', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/extension')>();
    return { ...actual, extensionStore: mocks.extensionStore };
});

function baseState(overrides: Partial<ExtensionMarketplaceState> = {}): ExtensionMarketplaceState {
    return {
        installed: [],
        commands: [],
        consoleLog: [],
        editorOpen: false,
        editorContent: '',
        ...overrides,
    };
}

function minimalManifest(id: string): ExtensionManifest {
    return {
        id,
        name: 'Test',
        version: '1.0.0',
        description: 'd',
        author: 'a',
        minDawVersion: '0.1.0',
        main: 'index.js',
        permissions: [],
        category: 'utilities',
        license: 'MIT',
    };
}

describe('installExtension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('adds to installed', () => {
        mocks.extensionStore.value = baseState();

        installExtension(minimalManifest('ext-a'));

        expect(mocks.extensionStore.set).toHaveBeenCalledTimes(1);
        const next = mocks.extensionStore.set.mock.calls[0]![0];
        expect(next.installed).toHaveLength(1);
        expect(next.installed[0]!.manifest.id).toBe('ext-a');
    });
});
