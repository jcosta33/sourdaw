import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    type ExtensionManifest,
    type ExtensionMarketplaceState,
    type InstalledExtension,
} from '../../../stores/extension';
import { toggleExtension } from '../toggleExtension';

const mocks = vi.hoisted(() => ({
    extensionStore: { value: null as any, set: vi.fn() },
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

function manifest(id: string): ExtensionManifest {
    return {
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
    };
}

describe('toggleExtension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('flips enabled', () => {
        const set = vi.fn();
        const installed: InstalledExtension[] = [
            { manifest: manifest('x'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
        ];

        mocks.extensionStore.value = baseState({ installed });
        mocks.extensionStore.set = set;

        toggleExtension('x');
        const next = set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.installed[0]!.enabled).toBe(false);
    });
});
