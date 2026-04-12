import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { clearConsole } from '../clearConsole';

const mocks = vi.hoisted(() => ({
    extensionStore: { value: null as any, set: vi.fn() },
}));

vi.mock('#/modules/Extension/stores/extension', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Extension/stores/extension')>();
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

describe('clearConsole', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('clears consoleLog', () => {
        const set = vi.fn();
        mocks.extensionStore.value = baseState({
            consoleLog: [{ timestamp: '', level: 'info', message: 'x' }],
        });
        mocks.extensionStore.set = set;

        clearConsole();
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ consoleLog: [] }));
    });
});
