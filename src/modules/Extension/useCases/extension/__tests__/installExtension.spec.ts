import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ExtensionManifest, type ExtensionMarketplaceState } from '../../../stores/extension';
import { installExtension } from '../installExtension';

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

function minimalManifest(id: string): ExtensionManifest {
    return {
        id,
        name: 'Test',
        version: '1.0.0',
        description: 'd',
        author: 'a',
        minDawVersion: '0.1.0',
        main: 'index.js',
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

describe('installExtension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setCurrentState(baseState());
    });

    it('should add to installed', () => {
        installExtension(minimalManifest('ext-a'));

        expect(mocks.extensionStore.update).toHaveBeenCalledTimes(1);
        const next = currentState();
        expect(next.installed).toHaveLength(1);
        expect(next.installed.map((extension) => extension.manifest.id)).toEqual(['ext-a']);
    });

    it('should preserve current commands, console log, and editor state when the value snapshot is stale', () => {
        const handler = vi.fn<() => void>();
        const current = baseState({
            commands: [{ id: 'current.command', extensionId: 'current', label: 'Current', description: 'd', handler }],
            consoleLog: [{ timestamp: 'now', level: 'warn', message: 'current log' }],
            editorOpen: true,
            editorContent: 'current editor',
        });

        mocks.setCurrentState(current);
        mocks.setValueSnapshot(baseState());

        installExtension(minimalManifest('ext-a'));

        const next = currentState();
        expect(next.installed.map((extension) => extension.manifest.id)).toEqual(['ext-a']);
        expect(next.commands).toEqual(current.commands);
        expect(next.consoleLog).toEqual(current.consoleLog);
        expect(next.editorOpen).toBe(true);
        expect(next.editorContent).toBe('current editor');
    });

    it('should ignore duplicate installs from the current store state', () => {
        const existing = {
            manifest: minimalManifest('ext-a'),
            enabled: false,
            installedAt: 'already-installed',
            lastUpdatedAt: 'already-updated',
            state: { saved: true },
        };

        mocks.setCurrentState(baseState({ installed: [existing] }));
        mocks.setValueSnapshot(baseState());

        installExtension(minimalManifest('ext-a'));

        expect(currentState().installed).toEqual([existing]);
    });
});
