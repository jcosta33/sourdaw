import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { clearConsole } from '../clearConsole';

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

describe('clearConsole', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('clears consoleLog', () => {
        const set = vi.fn();
        injectDependencies(clearConsole, {
            extensionStore: {
                value: baseState({
                    consoleLog: [{ timestamp: '', level: 'info', message: 'x' }],
                }),
                set,
            } as never,
        });
        clearConsole();
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ consoleLog: [] }));
    });
});
