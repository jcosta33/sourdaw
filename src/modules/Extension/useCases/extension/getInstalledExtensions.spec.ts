import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionManifest, type ExtensionMarketplaceState, type InstalledExtension } from '#/modules/Extension/stores/extension';
import { getInstalledExtensions } from './getInstalledExtensions';

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

describe('getInstalledExtensions', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns installed list', () => {
        const installed: InstalledExtension[] = [
            { manifest: manifest('x'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
        ];
        injectDependencies(getInstalledExtensions, {
            extensionStore: { value: baseState({ installed }), set: vi.fn() } as never,
        });
        expect(getInstalledExtensions()).toEqual(installed);
    });
});
