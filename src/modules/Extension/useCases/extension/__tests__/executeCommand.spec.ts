import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionMarketplaceState, type ScriptCommand } from '../../../stores/extension';
import { executeCommand } from '../executeCommand';

const mocks = vi.hoisted(() => ({
    extensionStore: {
        value: null as unknown as ExtensionMarketplaceState | null,
        set: vi.fn<(...args: unknown[]) => void>(),
    },
    appendLog: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../../../stores/extension', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/extension')>();
    return { ...actual, extensionStore: mocks.extensionStore };
});

vi.mock('../../../services/scripting', () => ({
    appendLog: mocks.appendLog,
}));

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
        vi.clearAllMocks();
    });

    it('runs handler when command exists', () => {
        const handler = vi.fn<() => void | Promise<void>>();
        const cmds: ScriptCommand[] = [{ id: 'ext.cmd', extensionId: 'ext', label: 'C', description: '', handler }];
        mocks.extensionStore.value = baseState({ commands: cmds });

        executeCommand('ext.cmd');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('logs when command missing', () => {
        mocks.extensionStore.value = baseState();

        executeCommand('missing');
        expect(mocks.appendLog).toHaveBeenCalledWith('error', 'Command not found: missing');
    });
});
