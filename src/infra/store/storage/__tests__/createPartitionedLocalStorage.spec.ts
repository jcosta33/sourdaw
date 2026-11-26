import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { createPartitionedLocalStorage, type LocalStoragePartition } from '../createPartitionedLocalStorage';

type Item = { id: string; label: string };
type Value = { version: number; items: Item[] };

const LEGACY_KEY = 'sourdaw-agent-runs';
const INDEX_KEY = 'sourdaw-agent-runs:index';
const PART_PREFIX = 'sourdaw-agent-runs:run:';

const partition: LocalStoragePartition<Value, { version: number }, Item> = {
    split: ({ items, ...index }) => ({ index, parts: items }),
    join: (index, items) => ({ ...index, items }),
    identify: (item) => item.id,
};

function createStorage(preserveSanitizedSourceWhen?: (value: unknown) => boolean) {
    return createPartitionedLocalStorage({
        legacyKey: LEGACY_KEY,
        indexKey: INDEX_KEY,
        partKeyPrefix: PART_PREFIX,
        partition,
        preserveSanitizedSourceWhen,
    });
}

function storedPartKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(PART_PREFIX)) {
            keys.push(key);
        }
    }
    return keys.toSorted();
}

function snapshotStorage(): Record<string, string | null> {
    return Object.fromEntries(
        [INDEX_KEY, LEGACY_KEY, ...storedPartKeys()].map((key) => [key, localStorage.getItem(key)])
    );
}

function usedUnits(storage: Storage): number {
    let total = 0;
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index) ?? '';
        total += key.length + (storage.getItem(key)?.length ?? 0);
    }
    return total;
}

/** Refuses any write that would leave more than `quota` key and value units stored, as a browser quota does. */
function refuseWritesPast(quota: number): void {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, text) {
        const current = this.getItem(key);
        const replacedUnits = current === null ? 0 : key.length + current.length;
        if (usedUnits(this) - replacedUnits + key.length + text.length > quota) {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
        setItem.call(this, key, text);
    });
}

/** Spies every write and removal, so a case can show a refused write touched nothing. */
function spyOnWrites() {
    return {
        setItem: vi.spyOn(Storage.prototype, 'setItem'),
        removeItem: vi.spyOn(Storage.prototype, 'removeItem'),
    };
}

type StoredState = Record<string, string>;

function readStoredState(): StoredState {
    const state: StoredState = {};
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index) ?? '';
        state[key] = localStorage.getItem(key) ?? '';
    }
    return state;
}

function restoreStoredState(state: StoredState): void {
    localStorage.clear();
    for (const [key, text] of Object.entries(state)) {
        localStorage.setItem(key, text);
    }
}

/** What storage holds after each write or removal `run` makes: where a crash could leave it. */
function recordStatesAfterEachWrite(run: () => void): StoredState[] {
    const states: StoredState[] = [];
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, text) {
        setItem.call(this, key, text);
        states.push(readStoredState());
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
        removeItem.call(this, key);
        states.push(readStoredState());
    });
    run();
    vi.restoreAllMocks();
    return states;
}

function items(count: number): Item[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `item-${String(index)}`,
        label: `Item ${String(index)}`,
    }));
}

describe('createPartitionedLocalStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('restores a written value in a fresh adapter', () => {
        const value = { version: 1, items: items(3) };
        expect(createStorage().trySet(value)).toBe(true);

        expect(createStorage().get()).toEqual(value);
        expect(storedPartKeys()).toHaveLength(3);
    });

    it('writes only the part whose object changed, and the index only when it changed', () => {
        const storage = createStorage();
        const first = { version: 1, items: items(20) };
        storage.trySet(first);
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        const changed = { ...first.items[7]!, label: 'Changed' };
        storage.trySet({ ...first, items: first.items.with(7, changed) });

        const writtenKeys = setItem.mock.calls.map(([key]) => key);
        expect(writtenKeys.filter((key) => key.startsWith(PART_PREFIX))).toHaveLength(1);
        expect(writtenKeys.filter((key) => key === INDEX_KEY)).toEqual([]);
        expect(storedPartKeys()).toHaveLength(20);
        expect(createStorage().get()?.items[7]).toEqual(changed);

        setItem.mockClear();
        storage.trySet({ version: 2, items: first.items.with(7, changed) });
        expect(setItem.mock.calls.map(([key]) => key)).toEqual([INDEX_KEY]);
    });

    it('puts back every part it replaced when the index write is refused', () => {
        const storage = createStorage();
        const first = { version: 1, items: items(3) };
        storage.trySet(first);
        const before = snapshotStorage();
        const setItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, text) {
            if (key === INDEX_KEY) {
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            setItem.call(this, key, text);
        });

        const next = { version: 2, items: [first.items[0]!, { id: 'item-1', label: 'Changed' }] };
        expect(() => storage.set(next)).toThrow('Quota exceeded');
        expect(storage.get()).toEqual(first);

        vi.restoreAllMocks();
        expect(snapshotStorage()).toEqual(before);
        expect(createStorage().get()).toEqual(first);
    });

    it('rewrites a changed part in place, so updating a part near the quota still fits', () => {
        // jsdom's quota is 5,000,000 units; two copies of a 3,000,000-unit part would exceed it.
        const storage = createStorage();
        const large = { id: 'item-0', label: 'a'.repeat(3_000_000) };
        expect(storage.trySet({ version: 1, items: [large] })).toBe(true);

        const updated = { ...large, label: 'b'.repeat(3_000_000) };
        expect(storage.trySet({ version: 1, items: [updated] })).toBe(true);

        expect(createStorage().get()?.items[0]?.label.startsWith('b')).toBe(true);
    });

    it('rewrites every changed part after another writer replaced the index', () => {
        const mine = createStorage();
        const value = { version: 1, items: items(3) };
        mine.trySet(value);
        const theirs = createStorage();
        theirs.get();
        theirs.trySet({ version: 1, items: [{ id: 'item-9', label: 'Theirs' }] });

        expect(mine.trySet({ ...value, items: value.items.slice(0, 2) })).toBe(true);

        expect(createStorage().get()).toEqual({ version: 1, items: value.items.slice(0, 2) });
        expect(storedPartKeys()).toHaveLength(2);
    });

    it('reads a value stored whole under the legacy key and removes that key on the next write', () => {
        const legacy = { version: 1, items: items(2) };
        localStorage.setItem(LEGACY_KEY, stringify(legacy));
        const storage = createStorage();

        expect(storage.get()).toEqual(legacy);
        expect(storage.trySet(legacy)).toBe(true);

        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
        expect(createStorage().get()).toEqual(legacy);
    });

    it('prefers the legacy key over an older index, since only an older build writes it', () => {
        createStorage().trySet({ version: 1, items: items(2) });
        const rewrittenByOlderBuild = { version: 1, items: [{ id: 'item-5', label: 'Older build' }] };
        localStorage.setItem(LEGACY_KEY, stringify(rewrittenByOlderBuild));

        const storage = createStorage();
        expect(storage.get()).toEqual(rewrittenByOlderBuild);
        storage.trySet(rewrittenByOlderBuild);

        expect(storedPartKeys()).toHaveLength(1);
        expect(createStorage().get()).toEqual(rewrittenByOlderBuild);
    });

    it('refuses writes and keeps the source bytes once a sanitized source is projected', () => {
        const future = stringify({ version: 2, items: [] });
        localStorage.setItem(LEGACY_KEY, future);
        const storage = createStorage((value) => typeof value === 'object' && value !== null);

        storage.setProjected?.({ version: 1, items: [] });

        expect(storage.trySet({ version: 1, items: items(1) })).toBe(false);
        expect(localStorage.getItem(LEGACY_KEY)).toBe(future);
        expect(storedPartKeys()).toEqual([]);
    });

    it.each([
        ['missing', (key: string) => localStorage.removeItem(key)],
        ['unparsable', (key: string) => localStorage.setItem(key, '{"json": not superjson')],
    ])('reads the other parts when the index names a %s part, and drops it on the next write', (_, tear) => {
        const value = { version: 1, items: items(3) };
        createStorage().trySet(value);
        tear(`${PART_PREFIX}item-1`);
        const warn = vi.spyOn(logger, 'warn');

        const storage = createStorage();
        const kept = { version: 1, items: [value.items[0]!, value.items[2]!] };
        expect(storage.get()).toEqual(kept);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(storage.trySet({ ...kept, version: 2 })).toBe(true);

        expect(storedPartKeys()).toEqual([`${PART_PREFIX}item-0`, `${PART_PREFIX}item-2`]);
        expect(createStorage().get()).toEqual({ ...kept, version: 2 });
    });

    it('never writes over storage whose index another writer replaced while it was read', () => {
        const first = { version: 1, items: items(3) };
        const theirs = { version: 2, items: items(3) };
        const writer = createStorage();
        writer.trySet(theirs);
        const theirIndexText = localStorage.getItem(INDEX_KEY) ?? '';
        writer.trySet(first);
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        let committedMidRead = false;
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
            if (!committedMidRead && key.startsWith(PART_PREFIX)) {
                committedMidRead = true;
                setItem.call(this, INDEX_KEY, theirIndexText);
            }
            return getItem.call(this, key);
        });

        const storage = createStorage();
        expect(storage.get()).toBeNull();
        vi.restoreAllMocks();
        const afterRead = snapshotStorage();
        const writes = spyOnWrites();
        expect(storage.trySet({ version: 1, items: [] })).toBe(false);

        expect(writes.setItem).not.toHaveBeenCalled();
        expect(writes.removeItem).not.toHaveBeenCalled();
        expect(snapshotStorage()).toEqual(afterRead);
        vi.restoreAllMocks();
        expect(createStorage().get()).toEqual(theirs);

        storage.clear();
        expect(storage.trySet(first)).toBe(true);
        expect(createStorage().get()).toEqual(first);
    });

    it('migrates a legacy value that fits once but not twice within the quota', () => {
        const legacy = {
            version: 1,
            items: Array.from({ length: 4 }, (_, index) => ({
                id: `item-${String(index)}`,
                label: 'x'.repeat(10_000),
            })),
        };
        const legacyText = stringify(legacy);
        localStorage.setItem(LEGACY_KEY, legacyText);
        refuseWritesPast(Math.ceil(1.5 * (LEGACY_KEY.length + legacyText.length)));

        const storage = createStorage();
        expect(storage.get()).toEqual(legacy);
        expect(storage.trySet(legacy)).toBe(true);

        expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
        vi.restoreAllMocks();
        expect(createStorage().get()).toEqual(legacy);
    });

    it('restores the legacy value byte for byte and leaves no part when a migration write is refused', () => {
        const legacy = { version: 1, items: items(3) };
        const legacyText = stringify(legacy);
        localStorage.setItem(LEGACY_KEY, legacyText);
        const setItem = Storage.prototype.setItem;
        let partWrites = 0;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, text) {
            if (key === `${PART_PREFIX}item-1`) {
                partWrites++;
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            setItem.call(this, key, text);
        });

        const storage = createStorage();
        expect(storage.get()).toEqual(legacy);
        expect(() => storage.set(legacy)).toThrow('Quota exceeded');

        vi.restoreAllMocks();
        // Refused beside the legacy value, then again once that value was set aside to make room.
        expect(partWrites).toBe(2);
        expect(localStorage.getItem(LEGACY_KEY)).toBe(legacyText);
        expect(storedPartKeys()).toEqual([]);
        expect(localStorage.getItem(INDEX_KEY)).toBeNull();
        expect(createStorage().get()).toEqual(legacy);
    });

    it('leaves a readable value wherever a migration stops', () => {
        const legacy = { version: 1, items: items(3) };
        localStorage.setItem(LEGACY_KEY, stringify(legacy));
        const next = { version: 2, items: legacy.items.with(1, { id: 'item-1', label: 'Changed' }) };

        const states = recordStatesAfterEachWrite(() => {
            const storage = createStorage();
            storage.get();
            expect(storage.trySet(next)).toBe(true);
        });

        expect(states.length).toBeGreaterThan(3);
        for (const state of states) {
            restoreStoredState(state);
            expect([legacy, next]).toContainEqual(createStorage().get());
        }
        expect(createStorage().get()).toEqual(next);
    });

    it('reads empty and writes again when a clear stops after its first removal', () => {
        const storage = createStorage();
        storage.trySet({ version: 1, items: items(3) });
        const removeItem = Storage.prototype.removeItem;
        let removals = 0;
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
            if (++removals === 2) {
                throw new Error('stopped');
            }
            removeItem.call(this, key);
        });

        expect(() => storage.clear()).toThrow('stopped');
        vi.restoreAllMocks();

        const fresh = createStorage();
        expect(fresh.get()).toBeNull();
        const next = { version: 1, items: [{ id: 'item-7', label: 'After' }] };
        expect(fresh.trySet(next)).toBe(true);
        expect(storedPartKeys()).toEqual([`${PART_PREFIX}item-7`]);
        expect(createStorage().get()).toEqual(next);
    });

    it('rewrites a committed part whose key another writer changed since', () => {
        const storage = createStorage();
        const value = { version: 1, items: items(3) };
        storage.trySet(value);
        localStorage.setItem(`${PART_PREFIX}item-1`, stringify({ id: 'item-1', label: 'Theirs' }));

        expect(storage.trySet({ ...value, version: 2 })).toBe(true);

        expect(createStorage().get()).toEqual({ ...value, version: 2 });
    });

    it('removes every part key the committed index does not name', () => {
        const storage = createStorage();
        const value = { version: 1, items: items(2) };
        storage.trySet(value);
        localStorage.setItem(`${PART_PREFIX}orphan`, stringify({ id: 'orphan', label: 'Left by a stopped write' }));

        expect(storage.trySet({ ...value, version: 2 })).toBe(true);

        expect(storedPartKeys()).toEqual([`${PART_PREFIX}item-0`, `${PART_PREFIX}item-1`]);
    });

    it('removes every key it owns on clear', () => {
        const storage = createStorage();
        storage.trySet({ version: 1, items: items(2) });

        storage.clear();

        expect(snapshotStorage()).toEqual({ [INDEX_KEY]: null, [LEGACY_KEY]: null });
        expect(createStorage().get()).toBeNull();
    });
});
