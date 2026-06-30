import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
    type ExtensionManifest,
    type ExtensionMarketplaceState,
    type InstalledExtension,
} from '../../../stores/extension';
import { toggleExtension } from '../toggleExtension';

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

function setCurrentState(state: ExtensionMarketplaceState | null): void {
    mocks.setCurrentState(state);
}

function setValueSnapshot(state: ExtensionMarketplaceState | null): void {
    mocks.setValueSnapshot(state);
}

function currentState(): ExtensionMarketplaceState {
    const state = mocks.getCurrentState();
    if (!state) {
        throw new Error('Expected extension store state');
    }
    return state;
}

describe('toggleExtension', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setCurrentState(baseState());
    });

    it('should flip enabled', () => {
        const installed: InstalledExtension[] = [
            { manifest: manifest('x'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
        ];

        setCurrentState(baseState({ installed }));

        toggleExtension('x');
        expect(mocks.extensionStore.update).toHaveBeenCalledTimes(1);
        expect(currentState().installed.map((extension) => extension.enabled)).toEqual([false]);
    });

    it('should preserve current installed entries when the value snapshot is stale', () => {
        const installed: InstalledExtension[] = [
            { manifest: manifest('x'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
            { manifest: manifest('y'), enabled: false, installedAt: '', lastUpdatedAt: '', state: {} },
        ];

        setCurrentState(baseState({ installed }));
        setValueSnapshot(baseState({ installed: installed.slice(0, 1) }));

        toggleExtension('x');

        expect(currentState().installed.map((extension) => [extension.manifest.id, extension.enabled])).toEqual([
            ['x', false],
            ['y', false],
        ]);
    });

    it('should only affect the matching extension', () => {
        const installed: InstalledExtension[] = [
            { manifest: manifest('x'), enabled: false, installedAt: '', lastUpdatedAt: '', state: {} },
            { manifest: manifest('y'), enabled: true, installedAt: '', lastUpdatedAt: '', state: {} },
        ];

        setCurrentState(baseState({ installed }));

        toggleExtension('x');

        expect(currentState().installed.map((extension) => [extension.manifest.id, extension.enabled])).toEqual([
            ['x', true],
            ['y', true],
        ]);
    });
});
