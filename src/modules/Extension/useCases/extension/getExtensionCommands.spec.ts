import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionMarketplaceState, type ScriptCommand } from '#/modules/Extension/stores/extension';
import { getExtensionCommands } from './getExtensionCommands';

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

describe('getExtensionCommands', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns commands from store', () => {
        const cmds: ScriptCommand[] = [
            { id: 'a.b', extensionId: 'a', label: 'B', description: '', handler: vi.fn() },
        ];
        injectDependencies(getExtensionCommands, {
            extensionStore: { value: baseState({ commands: cmds }), set: vi.fn() } as never,
        });
        expect(getExtensionCommands()).toEqual(cmds);
    });
});
