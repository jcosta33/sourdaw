import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionMarketplaceState } from '../../../stores/extension';
import { registerCommand } from '../registerCommand';

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

describe('registerCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('registers a command', () => {
        const set = vi.fn();
        mocks.extensionStore.value = baseState();
        mocks.extensionStore.set = set;

        const handler = vi.fn();
        registerCommand('myext', 'doit', 'Do', 'Desc', handler);
        expect(set).toHaveBeenCalled();
        const next = set.mock.calls[0]![0] as ExtensionMarketplaceState;
        expect(next.commands.some((c) => c.id === 'myext.doit')).toBe(true);
    });
});
