import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('removes every key it owns on clear', () => {
        const storage = createStorage();
        storage.trySet({ version: 1, items: items(2) });

        storage.clear();

        expect(snapshotStorage()).toEqual({ [INDEX_KEY]: null, [LEGACY_KEY]: null });
        expect(createStorage().get()).toBeNull();
    });
});
