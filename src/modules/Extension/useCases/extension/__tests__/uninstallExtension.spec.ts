import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    type ExtensionManifest,
    type ExtensionMarketplaceState,
    type InstalledExtension,
} from '../../../stores/extension';
import { uninstallExtension } from '../uninstallExtension';

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
        name: 'T',
        version: '1',
        description: 'd',
        author: 'a',
        minDawVersion: '0',
        main: 'm.js',
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

describe('uninstallExtension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setCurrentState(baseState());
    });

    it('should remove extension and its commands', () => {
        const installed: InstalledExtension[] = [
            {
                manifest: manifest('x'),
                enabled: true,
                installedAt: '',
                lastUpdatedAt: '',
                state: {},
            },
        ];
        mocks.setCurrentState(
            baseState({
                installed,
                commands: [{ id: 'x.c', extensionId: 'x', label: 'C', description: '', handler: vi.fn() }],
            })
        );

        uninstallExtension('x');

        expect(mocks.extensionStore.update).toHaveBeenCalledTimes(1);
        expect(currentState().installed).toHaveLength(0);
        expect(currentState().commands).toHaveLength(0);
    });

    it('should preserve unrelated installed entries, commands, and editor state when the value snapshot is stale', () => {
        const installed: InstalledExtension[] = [
            {
                manifest: manifest('x'),
                enabled: true,
                installedAt: '',
                lastUpdatedAt: '',
                state: {},
            },
            {
                manifest: manifest('y'),
                enabled: false,
                installedAt: 'y-installed',
                lastUpdatedAt: 'y-updated',
                state: { current: true },
            },
        ];
        const yHandler = vi.fn<() => void>();
        const current = baseState({
            installed,
            commands: [
                { id: 'x.c', extensionId: 'x', label: 'C', description: '', handler: vi.fn() },
                { id: 'y.c', extensionId: 'y', label: 'Y', description: '', handler: yHandler },
            ],
            consoleLog: [{ timestamp: 'now', level: 'warn', message: 'current log' }],
            editorOpen: true,
            editorContent: 'current editor',
        });

        mocks.setCurrentState(current);
        mocks.setValueSnapshot(
            baseState({
                installed: installed.slice(0, 1),
                commands: [{ id: 'x.c', extensionId: 'x', label: 'C', description: '', handler: vi.fn() }],
            })
        );

        uninstallExtension('x');

        const next = currentState();
        expect(next.installed.map((extension) => extension.manifest.id)).toEqual(['y']);
        expect(next.commands.map((command) => command.id)).toEqual(['y.c']);
        expect(next.consoleLog).toEqual(current.consoleLog);
        expect(next.editorOpen).toBe(true);
        expect(next.editorContent).toBe('current editor');
    });
});
