import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionMarketplaceState } from '../../../stores/extension';
import { setEditorContent } from '../setEditorContent';

const mocks = vi.hoisted(() => {
    type State = import('../../../stores/extension').ExtensionMarketplaceState;
    let currentState: State | null = null;
    let valueSnapshot: State | null = null;

    const extensionStore = {
        get value(): State | null {
            return valueSnapshot;
        },
        set: vi.fn<(state: State | null) => void>((state) => {
            currentState = state;
            valueSnapshot = state;
        }),
        update: vi.fn<(updater: (current: State | null) => State | null) => void>((updater) => {
            currentState = updater(currentState);
            valueSnapshot = currentState;
        }),
    };

    return {
        extensionStore,
        setCurrentState: (state: State | null) => {
            currentState = state;
            valueSnapshot = state;
        },
        setValueSnapshot: (state: State | null) => {
            valueSnapshot = state;
        },
        getCurrentState: () => currentState,
    };
});

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

function currentState(): ExtensionMarketplaceState {
    const state = mocks.getCurrentState();
    if (!state) {
        throw new Error('Expected extension store state');
    }
    return state;
}

describe('setEditorContent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setCurrentState(baseState());
    });

    it('should write editorContent', () => {
        setEditorContent('code');
        expect(mocks.extensionStore.update).toHaveBeenCalledTimes(1);
        expect(currentState().editorContent).toBe('code');
    });

    it('should preserve current installed, commands, log, and editor-open state when the value snapshot is stale', () => {
        const handler = vi.fn<() => void>();
        const current = baseState({
            installed: [
                {
                    manifest: {
                        id: 'ext-a',
                        name: 'A',
                        version: '1',
                        description: 'd',
                        author: 'a',
                        minDawVersion: '0',
                        main: 'main.js',
                        permissions: [],
                        category: 'utilities',
                        license: 'MIT',
                    },
                    enabled: true,
                    installedAt: 'installed',
                    lastUpdatedAt: 'updated',
                    state: {},
                },
            ],
            commands: [{ id: 'ext-a.run', extensionId: 'ext-a', label: 'Run', description: 'd', handler }],
            consoleLog: [{ timestamp: 'now', level: 'info', message: 'current log' }],
            editorOpen: true,
            editorContent: 'old editor',
        });

        mocks.setCurrentState(current);
        mocks.setValueSnapshot(baseState());

        setEditorContent('new editor');

        const next = currentState();
        expect(next.editorContent).toBe('new editor');
        expect(next.installed).toEqual(current.installed);
        expect(next.commands).toEqual(current.commands);
        expect(next.consoleLog).toEqual(current.consoleLog);
        expect(next.editorOpen).toBe(true);
    });
});
