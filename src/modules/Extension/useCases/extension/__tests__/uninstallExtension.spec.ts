import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionManifest, type ExtensionMarketplaceState, type InstalledExtension } from '#/modules/Extension/stores/extension';
import { uninstallExtension } from '../uninstallExtension';

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

describe('uninstallExtension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes extension and its commands', () => {
        const installed: InstalledExtension[] = [
            {
                manifest: manifest('x'),
                enabled: true,
                installedAt: '',
                lastUpdatedAt: '',
                state: {},
            },
        ];
        mocks.extensionStore.value = baseState({
            installed,
            commands: [{ id: 'x.c', extensionId: 'x', label: 'C', description: '', handler: vi.fn() }],
        });

        uninstallExtension('x');

        const next = mocks.extensionStore.set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.installed).toHaveLength(0);
        expect(next.commands).toHaveLength(0);
    });
});
