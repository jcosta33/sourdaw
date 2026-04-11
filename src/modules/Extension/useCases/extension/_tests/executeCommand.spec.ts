import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionMarketplaceState, type ScriptCommand } from '#/modules/Extension/stores/extension';
import { executeCommand } from '../executeCommand';

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

describe('executeCommand', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('runs handler when command exists', () => {
        const handler = vi.fn();
        const cmds: ScriptCommand[] = [
            { id: 'ext.cmd', extensionId: 'ext', label: 'C', description: '', handler },
        ];
        injectDependencies(executeCommand, {
            extensionStore: { value: baseState({ commands: cmds }), set: vi.fn() } as never,
            appendLog: vi.fn(),
        });
        executeCommand('ext.cmd');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('logs when command missing', () => {
        const appendLog = vi.fn();
        injectDependencies(executeCommand, {
            extensionStore: { value: baseState(), set: vi.fn() } as never,
            appendLog,
        });
        executeCommand('missing');
        expect(appendLog).toHaveBeenCalledWith('error', 'Command not found: missing');
    });
});
