import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectVersion, type VersionBranch, type VersionControlState } from '../../models/ProjectVersion';

const VC_STORAGE_KEY = 'sourdaw-version-control';
const OWNER_PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

function makeVersion(overrides: Partial<ProjectVersion> = {}): ProjectVersion {
    return {
        id: 'ver-1',
        label: 'v1',
        createdAt: '2024-01-01T00:00:00.000Z',
        parentId: null,
        description: 'first',
        snapshot: {
            ownerProjectId: OWNER_PROJECT_ID,
            data: JSON.stringify({ tracks: { tracks: [] } }),
            size: 1234,
        },
        tags: [],
        ...overrides,
    };
}

function makeBranch(overrides: Partial<VersionBranch> = {}): VersionBranch {
    return {
        id: 'branch-1',
        name: 'main',
        headVersionId: 'ver-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function makeState(overrides: Partial<VersionControlState> = {}): VersionControlState {
    return {
        versions: [makeVersion()],
        branches: [makeBranch()],
        currentBranchId: 'branch-1',
        currentVersionId: null,
        autoSaveInterval: 5,
        ...overrides,
    };
}

function storeRawState(value: unknown): void {
    window.localStorage.setItem(VC_STORAGE_KEY, JSON.stringify(value));
}

function getLocalStorageDescriptor(): PropertyDescriptor {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    if (!descriptor) {
        throw new Error('Expected localStorage descriptor');
    }

    return descriptor;
}

async function withLocalStorageDescriptor(
    descriptor: PropertyDescriptor,
    callback: () => Promise<void>
): Promise<void> {
    const originalDescriptor = getLocalStorageDescriptor();
    Object.defineProperty(globalThis, 'localStorage', descriptor);
    try {
        await callback();
    } finally {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    }
}

function createStorageMock(overrides: Partial<Storage> = {}): Storage {
    return {
        get length() {
            return 0;
        },
        clear: vi.fn(),
        getItem: vi.fn(() => null),
        key: vi.fn(() => null),
        removeItem: vi.fn(),
        setItem: vi.fn(),
        ...overrides,
    };
}

async function loadStoreValue(): Promise<VersionControlState | null> {
    const { versionControlStore } = await import('../versionControlStore');
    return versionControlStore.value;
}

function expectDefaultHydratedState(value: VersionControlState | null): void {
    expect(value).not.toBeNull();
    if (value === null) {
        throw new Error('Expected default version-control state');
    }

    expect(value.versions).toEqual([]);
    expect(value.branches).toHaveLength(1);
    const mainBranch = value.branches[0];
    if (!mainBranch) {
        throw new Error('Expected main branch');
    }

    expect(mainBranch.id).toMatch(/^branch-/);
    expect(mainBranch.name).toBe('main');
    expect(mainBranch.headVersionId).toBe('');
    expect(typeof mainBranch.createdAt).toBe('string');
    expect(value.currentBranchId).toBe(mainBranch.id);
    expect(value.currentVersionId).toBeNull();
    expect(value.autoSaveInterval).toBe(5);
}

describe('versionControlStore persistence', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.resetModules();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('should preserve valid stored metadata while stripping stale snapshot payloads', async () => {
        const storedState = makeState({
            versions: [
                makeVersion({
                    id: 'ver-root',
                    label: 'Root mix',
                    parentId: null,
                    description: 'created root',
                    tags: ['root', 'approved'],
                    snapshot: { ownerProjectId: OWNER_PROJECT_ID, data: '{"stale":"payload"}', size: 4096 },
                }),
                makeVersion({
                    id: 'ver-child',
                    label: 'Child mix',
                    parentId: 'ver-root',
                    createdAt: '2024-01-02T00:00:00.000Z',
                    description: 'balanced drums',
                    tags: ['mix'],
                    snapshot: { ownerProjectId: OWNER_PROJECT_ID, data: '{"stale":"child"}', size: 8192 },
                }),
            ],
            branches: [
                makeBranch({
                    id: 'branch-main',
                    name: 'main',
                    headVersionId: 'ver-child',
                    createdAt: '2024-01-03T00:00:00.000Z',
                }),
            ],
            currentBranchId: 'branch-main',
            currentVersionId: 'ver-child',
            autoSaveInterval: 15,
        });
        storeRawState(storedState);

        await expect(loadStoreValue()).resolves.toEqual({
            ...storedState,
            versions: storedState.versions.map((version) => ({
                ...version,
                snapshot: { ownerProjectId: OWNER_PROJECT_ID, data: '', size: 0 },
            })),
        });
    });

    it.each([
        { label: 'invalid top-level value', storedValue: null },
        { label: 'invalid required versions container', storedValue: { ...makeState(), versions: 'not-versions' } },
        {
            label: 'missing required branches container',
            storedValue: { ...makeState(), branches: undefined },
        },
        {
            label: 'invalid version entry',
            storedValue: { ...makeState(), versions: [{ ...makeVersion(), tags: ['mix', 42] }] },
        },
        {
            label: 'ownerless version entry',
            storedValue: {
                ...makeState(),
                versions: [
                    {
                        ...makeVersion(),
                        snapshot: { data: '{"legacy":true}', size: 15 },
                    },
                ],
            },
        },
        {
            label: 'invalid branch entry',
            storedValue: { ...makeState(), branches: [{ ...makeBranch(), headVersionId: 42 }] },
        },
        { label: 'invalid current branch ref', storedValue: { ...makeState(), currentBranchId: 'missing-branch' } },
        {
            label: 'invalid current version ref',
            storedValue: { ...makeState(), currentVersionId: 'missing-version' },
        },
        { label: 'invalid auto-save interval', storedValue: { ...makeState(), autoSaveInterval: -1 } },
    ])('should fall back to a fresh default state for $label', async ({ storedValue }) => {
        storeRawState(storedValue);

        expectDefaultHydratedState(await loadStoreValue());
    });

    it('should fall back to memory defaults when localStorage is unavailable', async () => {
        await withLocalStorageDescriptor({ value: undefined, configurable: true }, async () => {
            expectDefaultHydratedState(await loadStoreValue());
        });
    });

    it('should fall back to defaults when localStorage read throws', async () => {
        const storage = createStorageMock({
            getItem: vi.fn(() => {
                throw new Error('blocked');
            }),
        });

        await withLocalStorageDescriptor({ value: storage, configurable: true }, async () => {
            expectDefaultHydratedState(await loadStoreValue());
            expect(storage.getItem).toHaveBeenCalledWith(VC_STORAGE_KEY);
        });
    });

    it('should not throw when localStorage removeItem fails during clear', async () => {
        const storage = createStorageMock({
            removeItem: vi.fn(() => {
                throw new Error('blocked');
            }),
        });

        await withLocalStorageDescriptor({ value: storage, configurable: true }, async () => {
            const { versionControlStore } = await import('../versionControlStore');

            expect(() => {
                versionControlStore.clear();
            }).not.toThrow();
            expect(storage.removeItem).toHaveBeenCalledWith(VC_STORAGE_KEY);
        });
    });

    it('should not advertise a non-zero snapshot size for versions whose payload cannot be persisted', async () => {
        const { versionControlStore } = await import('../versionControlStore');
        const state = makeState();

        // Simulate a session writing a real version whose payload is stripped on persist.
        versionControlStore.set(state);
        expect(versionControlStore.value).toEqual(state);

        const raw = window.localStorage.getItem(VC_STORAGE_KEY);
        if (raw === null) {
            throw new Error('Expected persisted version-control state');
        }
        const persisted: unknown = JSON.parse(raw);

        // The payload could not be stored in localStorage; the metadata must not
        // claim a non-zero size, otherwise a reloaded version appears restorable
        // while restoreVersion silently no-ops on the empty payload.
        expect(persisted).toEqual({
            ...state,
            versions: state.versions.map((version) => ({
                ...version,
                snapshot: { ownerProjectId: OWNER_PROJECT_ID, data: '', size: 0 },
            })),
        });
    });
});
