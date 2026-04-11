import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionManifest, type ExtensionMarketplaceState, type InstalledExtension } from '#/modules/Extension/stores/extension';
import { toggleExtension } from '../toggleExtension';

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

describe('toggleExtension', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('flips enabled', () => {
        const set = vi.fn();
        const installed: InstalledExtension[] = [
            { manifest: manifest('x'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
        ];
        injectDependencies(toggleExtension, {
            extensionStore: { value: baseState({ installed }), set } as never,
        });
        toggleExtension('x');
        const next = set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.installed[0]!.enabled).toBe(false);
    });
});
