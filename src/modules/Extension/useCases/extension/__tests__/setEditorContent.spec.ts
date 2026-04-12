import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { setEditorContent } from '../setEditorContent';

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

describe('setEditorContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('writes editorContent', () => {
        const set = vi.fn();
        mocks.extensionStore.value = baseState();
        mocks.extensionStore.set = set;

        setEditorContent('code');
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ editorContent: 'code' }));
    });
});
