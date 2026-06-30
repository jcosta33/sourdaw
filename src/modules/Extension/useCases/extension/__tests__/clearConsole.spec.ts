import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionMarketplaceState } from '../../../stores/extension';
import { clearConsole } from '../clearConsole';

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

describe('clearConsole', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setCurrentState(baseState());
    });

    it('should clear consoleLog', () => {
        mocks.setCurrentState(
            baseState({
                consoleLog: [{ timestamp: '', level: 'info', message: 'x' }],
            })
        );

        clearConsole();
        expect(mocks.extensionStore.update).toHaveBeenCalledTimes(1);
        expect(currentState().consoleLog).toEqual([]);
    });

    it('should preserve current installed and editor state when the value snapshot is stale', () => {
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
            consoleLog: [{ timestamp: '', level: 'info', message: 'x' }],
            editorOpen: true,
            editorContent: 'current editor',
        });

        mocks.setCurrentState(current);
        mocks.setValueSnapshot(baseState({ consoleLog: [{ timestamp: '', level: 'error', message: 'stale' }] }));

        clearConsole();

        const next = currentState();
        expect(next.consoleLog).toEqual([]);
        expect(next.installed).toEqual(current.installed);
        expect(next.editorOpen).toBe(true);
        expect(next.editorContent).toBe('current editor');
    });
});
