import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionManifest, type ExtensionMarketplaceState, type InstalledExtension } from '#/modules/Extension/stores/extension';
import { getEnabledExtensions } from '../getEnabledExtensions';

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
        Container.clear();
    });

    it('filters to enabled only', () => {
        const installed: InstalledExtension[] = [
            { manifest: manifest('on'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
            { manifest: manifest('off'), enabled: false, installedAt: '', lastUpdatedAt: '', state: {} },
        ];
        injectDependencies(getEnabledExtensions, {
            extensionStore: { value: baseState({ installed }), set: vi.fn() } as never,
        });
        expect(getEnabledExtensions()).toHaveLength(1);
        expect(getEnabledExtensions()[0]!.manifest.id).toBe('on');
    });
});
