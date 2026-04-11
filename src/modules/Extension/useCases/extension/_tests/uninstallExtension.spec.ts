import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionManifest, type ExtensionMarketplaceState, type InstalledExtension } from '#/modules/Extension/stores/extension';
import { uninstallExtension } from '../uninstallExtension';

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
        Container.clear();
    });

    it('removes extension and its commands', () => {
        const set = vi.fn();
        const installed: InstalledExtension[] = [
            {
                manifest: manifest('x'),
                enabled: true,
                installedAt: '',
                lastUpdatedAt: '',
                state: {},
            },
        ];
        injectDependencies(uninstallExtension, {
            extensionStore: {
                value: baseState({
                    installed,
                    commands: [{ id: 'x.c', extensionId: 'x', label: 'C', description: '', handler: vi.fn() }],
                }),
                set,
            } as never,
        });
        uninstallExtension('x');
        const next = set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.installed).toHaveLength(0);
        expect(next.commands).toHaveLength(0);
    });
});
