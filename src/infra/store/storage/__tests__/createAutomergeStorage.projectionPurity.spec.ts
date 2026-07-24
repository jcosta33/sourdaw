import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '../createAutomergeStorage';

/**
 * Audit CC-2 — `hydrate()` must be a pure reader.
 *
 * The adapter contract (`StorageAdapter.hydrate`, storage/types.ts) says
 * "hydrate the cache from the backing store **without triggering a
 * write-back**". The known-but-absent branch violated it: a missing slot with
 * a live cache called `writeToCrdt(cachedValue)`, making the projection a
 * second writer, recursing back through the projection bridge, and bleeding a
 * previous project's cache into a fresh document.
 */

type TestDoc = { [key: string]: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type CreateTestPortInput = {
    initialDoc?: TestDoc;
    /** Runs after every applied mutation — models the projection bridge. */
    onMutate?: () => void;
};

function createTestPort(input: CreateTestPortInput = {}): {
    doc: TestDoc;
    mutatedKeys: string[][];
    port: TestPort;
} {
    const doc = input.initialDoc ?? {};
    const mutatedKeys: string[][] = [];
    let headsCounter = 0;
    const port: TestPort = {
        getDoc: () => doc,
        getDocHeads: () => [`head-${headsCounter}`],
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn, changedKeys }) => {
            changeFn(doc);
            headsCounter += 1;
            mutatedKeys.push([...changedKeys]);
            input.onMutate?.();
        },
    };
    return { doc, mutatedKeys, port };
}

describe('createAutomergeStorage projection purity (audit CC-2)', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('leaves the document untouched when hydrating a slot that is absent from it', () => {
        const { doc, mutatedKeys, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        storage.set({ count: 9 });
        // The deferred write has not flushed, so the slot is still absent. A
        // projection pass here must read, never write.
        const changed = storage.hydrate?.();

        expect(changed).toBe(false);
        expect(mutatedKeys).toEqual([]);
        expect(Object.hasOwn(doc, 'state')).toBe(false);
        expect(storage.get()).toEqual({ count: 9 });
    });

    it('replaces the cache with the hydrateMissing default instead of writing the cache back', () => {
        const { doc, mutatedKeys, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            hydrateMissing: () => ({ count: 0 }),
        });

        storage.set({ count: 9 });
        const changed = storage.hydrate?.();

        expect(changed).toBe(true);
        expect(storage.get()).toEqual({ count: 0 });
        expect(mutatedKeys).toEqual([]);
        expect(Object.hasOwn(doc, 'state')).toBe(false);
    });

    it('runs one hydrate per slot instead of a re-entrant nested projection storm', () => {
        const slots = ['slotA', 'slotB', 'slotC', 'slotD'];
        let hydrateCalls = 0;
        const projectAll = (): void => {
            for (const storage of storages) {
                hydrateCalls += 1;
                storage.hydrate?.();
            }
        };
        const { mutatedKeys, port } = createTestPort({ onMutate: () => projectAll() });
        configureAutomergeStoragePort(port);
        const storages = slots.map((slot) => createAutomergeStorage<{ value: string }>('root', slot));
        for (const storage of storages) {
            storage.set({ value: 'from-previous-project' });
        }

        projectAll();

        // One pass, one hydrate per slot. The back-write turned each absent
        // slot into a nested full pass (4 slots -> 4 + 4*4 = 20 hydrates).
        expect(hydrateCalls).toBe(slots.length);
        expect(mutatedKeys).toEqual([]);
    });

    it('reports the changed slot keys with every document mutation', () => {
        const { mutatedKeys, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'tracks');

        storage.set({ count: 1 });
        flushAutomergeStorageWrites();

        expect(mutatedKeys).toEqual([['tracks']]);
    });

    it('skips re-serializing a slot whose document heads have not moved', () => {
        const { port } = createTestPort({ initialDoc: { state: { count: 4 } } });
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');

        expect(storage.hydrate?.()).toBe(true);

        const stringifySpy = vi.spyOn(JSON, 'stringify');
        try {
            expect(storage.hydrate?.()).toBe(false);
            expect(stringifySpy).not.toHaveBeenCalled();
        } finally {
            stringifySpy.mockRestore();
        }
    });

    it('resets a stale cache to its projection default on an authority switch', () => {
        const { doc, mutatedKeys, port } = createTestPort();
        configureAutomergeStoragePort(port);
        const storage = createAutomergeStorage<{ tracks: string[] }>('root', 'tracks', {
            hydrateMissing: () => ({ tracks: [] }),
        });
        const seen: Array<{ tracks: string[] } | null> = [];
        storage.subscribe?.(() => {
            seen.push(storage.get());
        });

        storage.set({ tracks: ['previous-project-track'] });
        resetAutomergeStorageProjections('root');

        expect(storage.get()).toEqual({ tracks: [] });
        expect(seen.at(-1)).toEqual({ tracks: [] });

        // The dropped pending write must not resurrect the previous project's
        // tracks into the fresh document.
        flushAutomergeStorageWrites();
        expect(mutatedKeys).toEqual([]);
        expect(Object.hasOwn(doc, 'tracks')).toBe(false);
    });

    it('leaves adapters on other documents untouched when one document resets', () => {
        const { port } = createTestPort();
        configureAutomergeStoragePort(port);
        const rootStorage = createAutomergeStorage<{ id: string }>('root', 'projectMeta', {
            hydrateMissing: () => ({ id: 'default' }),
        });
        const branchStorage = createAutomergeStorage<{ id: string }>('branch_a', 'projectMeta', {
            hydrateMissing: () => ({ id: 'default' }),
        });

        rootStorage.set({ id: 'root-value' });
        branchStorage.set({ id: 'branch-value' });
        resetAutomergeStorageProjections('root');

        expect(rootStorage.get()).toEqual({ id: 'default' });
        expect(branchStorage.get()).toEqual({ id: 'branch-value' });
    });
});
