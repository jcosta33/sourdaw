import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionManifest, type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { installExtension } from './installExtension';

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
        Container.clear();
    });

    it('adds to installed', () => {
        const set = vi.fn();
        injectDependencies(installExtension, {
            extensionStore: { value: baseState(), set } as never,
        });
        installExtension(minimalManifest('ext-a'));
        const next = set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.installed).toHaveLength(1);
        expect(next.installed[0]!.manifest.id).toBe('ext-a');
    });
});
