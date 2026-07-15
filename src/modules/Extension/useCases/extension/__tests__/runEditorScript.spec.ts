import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionMarketplaceState } from '../../../stores/extension';
import { runEditorScript } from '../runEditorScript';

const mocks = vi.hoisted(() => ({
    extensionStore: {
        value: null as unknown as ExtensionMarketplaceState,
        set: vi.fn<(state: ExtensionMarketplaceState) => void>(),
    },
    appendLog: vi.fn<(...args: unknown[]) => void>(),
    createDawApi: vi.fn<() => Record<string, unknown>>(() => ({})),
}));

vi.mock('../../../stores/extension', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../stores/extension')>();
    return { ...actual, extensionStore: mocks.extensionStore };
});

vi.mock('../appendLog', () => ({
    appendLog: mocks.appendLog,
}));

vi.mock('../createDawApi', () => ({
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

    it('logs script console output and runtime errors', () => {
        mocks.extensionStore.value = baseState({ editorContent: 'console.log("hello"); throw new Error("boom");' });

        runEditorScript();

        expect(mocks.appendLog).toHaveBeenNthCalledWith(1, 'info', '▶ Running script...');
        expect(mocks.appendLog).toHaveBeenNthCalledWith(2, 'info', 'hello');
        expect(mocks.appendLog).toHaveBeenNthCalledWith(3, 'error', 'Script error: Error: boom');
        expect(mocks.appendLog).not.toHaveBeenCalledWith('info', '✓ Script completed');
    });
});
