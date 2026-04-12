import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { toggleScriptEditor } from '../toggleScriptEditor';

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

describe('toggleScriptEditor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('flips editorOpen', () => {
        mocks.extensionStore.value = baseState({ editorOpen: false });
        
        toggleScriptEditor();
        
        expect(mocks.extensionStore.set).toHaveBeenCalledWith(expect.objectContaining({ editorOpen: true }));
    });
});
