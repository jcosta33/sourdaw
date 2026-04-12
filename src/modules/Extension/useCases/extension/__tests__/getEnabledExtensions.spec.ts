import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionManifest, type ExtensionMarketplaceState, type InstalledExtension } from '#/modules/Extension/stores/extension';
import { getEnabledExtensions } from '../getEnabledExtensions';

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

const manifest = (id: string): ExtensionManifest => ({
    id,
    name: 'T',
    version: '1',
    description: 'd',
    author: 'a',
    minDawVersion: '0',
    main: 'm.js',
    permissions: [],
    category: 'utilities',
    license: 'MIT',
});

describe('getEnabledExtensions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('filters to enabled only', () => {
        const installed: InstalledExtension[] = [
            { manifest: manifest('on'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
            { manifest: manifest('off'), enabled: false, installedAt: '', lastUpdatedAt: '', state: {} },
        ];
        mocks.extensionStore.value = baseState({ installed });
        
        expect(getEnabledExtensions()).toHaveLength(1);
        expect(getEnabledExtensions()[0]!.manifest.id).toBe('on');
    });
});
