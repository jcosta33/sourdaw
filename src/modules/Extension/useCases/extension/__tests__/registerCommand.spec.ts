import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionMarketplaceState } from '../../../stores/extension';
import { registerCommand } from '../registerCommand';

const mocks = vi.hoisted(() => ({
    extensionStore: {
        value: null as unknown as ExtensionMarketplaceState | null,
        set: vi.fn<(state: ExtensionMarketplaceState | null) => void>(),
        update: vi.fn<
            (updater: (current: ExtensionMarketplaceState | null) => ExtensionMarketplaceState | null) => void
        >(),
    },
    currentState: null as ExtensionMarketplaceState | null,
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

function setCurrentState(state: ExtensionMarketplaceState | null): void {
    mocks.currentState = state;
    mocks.extensionStore.value = state;
    mocks.extensionStore.set.mockImplementation((nextState) => {
        mocks.currentState = nextState;
        mocks.extensionStore.value = nextState;
    });
    mocks.extensionStore.update.mockImplementation((updater) => {
        mocks.currentState = updater(mocks.currentState);
        mocks.extensionStore.value = mocks.currentState;
    });
}

function setValueSnapshot(state: ExtensionMarketplaceState | null): void {
    mocks.extensionStore.value = state;
}

function currentState(): ExtensionMarketplaceState {
    const state = mocks.currentState;
    if (!state) {
        throw new Error('Expected extension store state');
    }
    return state;
}

describe('registerCommand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentState(baseState());
    });

    it('should register a command', () => {
        const handler = vi.fn();
        registerCommand('myext', 'doit', 'Do', 'Desc', handler);
        expect(mocks.extensionStore.update).toHaveBeenCalledTimes(1);
        const next = currentState();
        expect(next.commands.some((c) => c.id === 'myext.doit')).toBe(true);
    });

    it('should preserve current installed, editor, and log state when the value snapshot is stale', () => {
        const handler = vi.fn();
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
            consoleLog: [{ timestamp: 'now', level: 'info', message: 'current log' }],
            editorOpen: true,
            editorContent: 'current editor',
        });

        setCurrentState(current);
        setValueSnapshot(baseState());

        registerCommand('myext', 'doit', 'Do', 'Desc', handler);

        const next = currentState();
        expect(next.commands.map((command) => command.id)).toEqual(['myext.doit']);
        expect(next.installed).toEqual(current.installed);
        expect(next.consoleLog).toEqual(current.consoleLog);
        expect(next.editorOpen).toBe(true);
        expect(next.editorContent).toBe('current editor');
    });

    it('should replace a command with the same id', () => {
        const firstHandler = vi.fn();
        const replacementHandler = vi.fn();
        setCurrentState(
            baseState({
                commands: [
                    {
                        id: 'myext.doit',
                        extensionId: 'myext',
                        label: 'Old',
                        description: 'Old description',
                        handler: firstHandler,
                    },
                ],
            })
        );

        registerCommand('myext', 'doit', 'New', 'New description', replacementHandler);

        expect(currentState().commands).toEqual([
            {
                id: 'myext.doit',
                extensionId: 'myext',
                label: 'New',
                description: 'New description',
                handler: replacementHandler,
            },
        ]);
    });
});
