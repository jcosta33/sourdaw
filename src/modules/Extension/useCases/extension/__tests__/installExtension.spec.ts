import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionManifest, type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { installExtension } from '../installExtension';

const mocks = vi.hoisted(() => ({
    extensionStore: { value: null as any, set: vi.fn() },
}));

vi.mock('#/modules/Extension/stores/extension', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Extension/stores/extension')>();
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

const minimalManifest = (id: string): ExtensionManifest => ({
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
});

describe('installExtension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('adds to installed', () => {
        mocks.extensionStore.value = baseState();
        
        installExtension(minimalManifest('ext-a'));
        
        expect(mocks.extensionStore.set).toHaveBeenCalledTimes(1);
        const next = mocks.extensionStore.set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.installed).toHaveLength(1);
        expect(next.installed[0]!.manifest.id).toBe('ext-a');
    });
});
