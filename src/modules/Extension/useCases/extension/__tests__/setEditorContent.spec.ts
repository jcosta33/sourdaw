import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionMarketplaceState } from '../../../stores/extension';
import { setEditorContent } from '../setEditorContent';

const mocks = vi.hoisted(() => ({
    extensionStore: {
        value: null as import('../../../stores/extension').ExtensionMarketplaceState | null,
        set: vi.fn(),
    },
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
