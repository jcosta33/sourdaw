import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ExtensionManifest, type ExtensionMarketplaceState } from '../../../stores/extension';
import { appendLog } from '../appendLog';

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

function manifest(id: string): ExtensionManifest {
    return {
        id,
        name: 'Test',
        version: '1',
        description: 'd',
        author: 'a',
        minDawVersion: '0',
        main: 'main.js',
        permissions: [],
        category: 'utilities',
        license: 'MIT',
    };
}

function currentState(): ExtensionMarketplaceState {
    const state = mocks.getCurrentState();
    if (!state) {
        throw new Error('Expected extension store state');
    }
    return state;
}

describe('appendLog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setCurrentState(baseState());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should append a console entry and cap length at 100', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'));
        mocks.setCurrentState(
            baseState({
                consoleLog: Array.from({ length: 100 }, (_, index) => ({
                    timestamp: 't',
                    level: 'info' as const,
                    message: String(index),
                })),
            })
        );

        appendLog('warn', 'next');

        const next = currentState();
        expect(mocks.extensionStore.update).toHaveBeenCalledTimes(1);
        expect(next.consoleLog).toHaveLength(100);
        expect(next.consoleLog.map((entry) => entry.message).slice(0, 1)).toEqual(['1']);
        expect(next.consoleLog).toContainEqual({
            timestamp: '2026-06-30T10:00:00.000Z',
            level: 'warn',
            message: 'next',
        });
    });

    it('should preserve current installed and editor state while capping when the value snapshot is stale', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'));
        const currentLog = Array.from({ length: 100 }, (_, index) => ({
            timestamp: 'current',
            level: 'info' as const,
            message: `current-${index}`,
        }));
        const current = baseState({
            installed: [
                {
                    manifest: manifest('ext-a'),
                    enabled: true,
                    installedAt: 'installed',
                    lastUpdatedAt: 'updated',
                    state: {},
                },
            ],
            editorOpen: true,
            editorContent: 'current editor',
            consoleLog: currentLog,
        });

        mocks.setCurrentState(current);
        mocks.setValueSnapshot(
            baseState({
                consoleLog: Array.from({ length: 100 }, (_, index) => ({
                    timestamp: 'stale',
                    level: 'error' as const,
                    message: `stale-${index}`,
                })),
            })
        );

        appendLog('warn', 'next');

        const next = currentState();
        expect(next.installed).toEqual(current.installed);
        expect(next.editorOpen).toBe(true);
        expect(next.editorContent).toBe('current editor');
        expect(next.consoleLog).toHaveLength(100);
        expect(next.consoleLog.map((entry) => entry.message).slice(0, 2)).toEqual(['current-1', 'current-2']);
        expect(next.consoleLog).toContainEqual({
            timestamp: '2026-06-30T10:00:00.000Z',
            level: 'warn',
            message: 'next',
        });
    });

    it('should not mutate when extension store is empty', () => {
        mocks.setCurrentState(null);
        appendLog('info', 'x');
        expect(mocks.getCurrentState()).toBeNull();
    });
});
