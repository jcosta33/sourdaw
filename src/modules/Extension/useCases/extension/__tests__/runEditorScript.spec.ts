import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ExtensionMarketplaceState } from '../../../stores/extension';
import { runEditorScript } from '../runEditorScript';

const mocks = vi.hoisted(() => ({
    extensionStore: { value: null as any, set: vi.fn() },
    appendLog: vi.fn(),
    createDawApi: vi.fn(() => ({})),
}));

vi.mock('../../../stores/extension', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/extension')>();
    return { ...actual, extensionStore: mocks.extensionStore };
});

vi.mock('../../../services/scripting', () => ({
    appendLog: mocks.appendLog,
    createDawApi: mocks.createDawApi,
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

describe('runEditorScript', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('runs editor content and logs completion', () => {
        mocks.extensionStore.value = baseState({ editorContent: '' });
        
        runEditorScript();
        
        expect(mocks.appendLog).toHaveBeenCalledWith('info', '▶ Running script...');
        expect(mocks.appendLog).toHaveBeenCalledWith('info', '✓ Script completed');
        expect(mocks.createDawApi).toHaveBeenCalled();
    });
});
