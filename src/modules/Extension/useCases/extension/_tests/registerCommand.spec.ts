import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { registerCommand } from '../registerCommand';

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

describe('registerCommand', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('registers a command', () => {
        const set = vi.fn();
        injectDependencies(registerCommand, {
            extensionStore: { value: baseState(), set } as never,
        });
        const handler = vi.fn();
        registerCommand('myext', 'doit', 'Do', 'Desc', handler);
        expect(set).toHaveBeenCalled();
        const next = set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.commands.some((c) => c.id === 'myext.doit')).toBe(true);
    });
});
