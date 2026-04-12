import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionMarketplaceState, type ScriptCommand } from '../../../stores/extension';
import { getExtensionCommands } from '../getExtensionCommands';

const mocks = vi.hoisted(() => ({
    extensionStore: { value: null as any, set: vi.fn() },
}));

vi.mock('../../../stores/extension', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/extension')>();
    return { ...actual, extensionStore: mocks.extensionStore };
});

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
        vi.clearAllMocks();
    });

    it('returns commands from store', () => {
        const cmds: ScriptCommand[] = [
            { id: 'a.b', extensionId: 'a', label: 'B', description: '', handler: vi.fn() },
        ];
        mocks.extensionStore.value = baseState({ commands: cmds });
        
        expect(getExtensionCommands()).toEqual(cmds);
    });
});
