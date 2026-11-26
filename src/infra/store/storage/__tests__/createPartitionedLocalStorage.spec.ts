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

/**
 * What storage holds after each write or removal `run` makes: where a crash could leave it. A
 * write `refuse` names is refused for quota instead, as a full browser store refuses it.
 */
function recordStatesAfterEachWrite(
    run: () => void,
    refuse: (key: string, text: string) => boolean = () => false
): StoredState[] {
    const states: StoredState[] = [];
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, text) {
        if (refuse(key, text)) {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        }
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

/**
 * The event a browser fires in this document when another tab writes `key` (null for a clear).
 * jsdom fires none for this document's own writes, so a case standing in for another tab fires it.
 */
function announceOtherWriter(key: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
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
        vi.useRealTimers();
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
        announceOtherWriter(INDEX_KEY);

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

    function bigLegacyValue(version: number) {
        return {
            version,
            items: Array.from({ length: 4 }, (_, index) => ({
                id: `item-${String(index)}`,
                label: 'x'.repeat(10_000),
            })),
        };
    }

    it('keeps a value that fits once but not twice within the quota whole under the legacy key', () => {
        const legacy = bigLegacyValue(1);
        const legacyText = stringify(legacy);
        localStorage.setItem(LEGACY_KEY, legacyText);
        refuseWritesPast(Math.ceil(1.5 * (LEGACY_KEY.length + legacyText.length)));

        const storage = createStorage();
        expect(storage.get()).toEqual(legacy);
        const next = bigLegacyValue(2);
        expect(storage.trySet(next)).toBe(true);

        vi.restoreAllMocks();
        expect(localStorage.getItem(LEGACY_KEY)).toBe(stringify(next));
        expect(localStorage.getItem(INDEX_KEY)).toBeNull();
        expect(storedPartKeys()).toEqual([]);
        expect(createStorage().get()).toEqual(next);
    });

    it('reads a whole value wherever a migration refused for quota stops', () => {
        const legacy = bigLegacyValue(1);
        localStorage.setItem(LEGACY_KEY, stringify(legacy));
        const next = bigLegacyValue(2);

        const states = recordStatesAfterEachWrite(
            () => {
                const storage = createStorage();
                storage.get();
                expect(storage.trySet(next)).toBe(true);
            },
            (key) => key === `${PART_PREFIX}item-2`
        );

        expect(states.length).toBeGreaterThan(3);
        for (const state of states) {
            restoreStoredState(state);
            expect([legacy, next]).toContainEqual(createStorage().get());
        }
        expect(createStorage().get()).toEqual(next);
    });

    it('restores the legacy value byte for byte and leaves no part when the legacy write is refused too', () => {
        const legacy = { version: 1, items: items(3) };
        const legacyText = stringify(legacy);
        localStorage.setItem(LEGACY_KEY, legacyText);
        const setItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, text) {
            if (key === `${PART_PREFIX}item-1` || key === LEGACY_KEY) {
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            setItem.call(this, key, text);
        });

        const storage = createStorage();
        expect(storage.get()).toEqual(legacy);
        expect(() => storage.set({ ...legacy, version: 2 })).toThrow('Quota exceeded');

        vi.restoreAllMocks();
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

    it('leaves an unchanged part whose key still holds its committed text unwritten', () => {
        const storage = createStorage();
        const value = { version: 1, items: items(3) };
        storage.trySet(value);
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        expect(storage.trySet({ ...value, version: 2 })).toBe(true);

        expect(setItem.mock.calls.map(([key]) => key)).toEqual([INDEX_KEY]);
    });

    it.each([
        [
            'commits a value without one part and with another changed',
            (theirs: ReturnType<typeof createStorage>, value: Value) => {
                theirs.trySet({ version: 1, items: [{ id: 'item-1', label: 'Theirs' }, value.items[2]!] });
            },
        ],
        [
            'commits a value with one part changed',
            (theirs: ReturnType<typeof createStorage>, value: Value) => {
                theirs.trySet({ ...value, items: value.items.with(1, { id: 'item-1', label: 'Theirs' }) });
            },
        ],
    ])('saves exactly its value after another writer %s and no storage event arrived', (_, commitTheirs) => {
        const mine = createStorage();
        const value = { version: 1, items: items(3) };
        mine.trySet(value);
        const theirs = createStorage();
        theirs.get();
        commitTheirs(theirs, value);

        const next = { ...value, version: 2 };
        expect(mine.trySet(next)).toBe(true);

        expect(createStorage().get()).toEqual(next);
    });

    type Interleaving = { old: Value; next: Value; final: Value; refuse?: (key: string) => boolean };

    /** One fresh adapter's read before each write and removal `commit` makes, and one after its last. */
    function readAtEveryStepOf(commit: () => void, refuse: (key: string) => boolean = () => false) {
        const reads: { adapter: ReturnType<typeof createStorage>; value: Value | null }[] = [];
        const read = () => {
            const adapter = createStorage();
            reads.push({ adapter, value: adapter.get() });
        };
        const setItem = Storage.prototype.setItem;
        const removeItem = Storage.prototype.removeItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, text) {
            read();
            if (refuse(key)) {
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            setItem.call(this, key, text);
        });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
            read();
            removeItem.call(this, key);
        });
        commit();
        vi.restoreAllMocks();
        read();
        return reads;
    }

    it.each<[string, () => Interleaving]>([
        [
            'evicts, changes and adds parts',
            () => {
                const old = { version: 1, items: items(3) };
                createStorage().trySet(old);
                const next = {
                    version: 2,
                    items: [{ id: 'item-1', label: 'Changed' }, old.items[2]!, ...items(4).slice(3)],
                };
                return { old, next, final: next };
            },
        ],
        [
            'changes one part and nothing else',
            () => {
                const old = { version: 1, items: items(3) };
                createStorage().trySet(old);
                const next = { ...old, items: old.items.with(1, { id: 'item-1', label: 'Changed' }) };
                return { old, next, final: next };
            },
        ],
        [
            'migrates the legacy value',
            () => {
                const old = { version: 1, items: items(3) };
                localStorage.setItem(LEGACY_KEY, stringify(old));
                const next = { version: 2, items: old.items.with(1, { id: 'item-1', label: 'Changed' }) };
                return { old, next, final: next };
            },
        ],
        [
            'is refused for quota at its index and puts back what it replaced',
            () => {
                const old = { version: 1, items: items(3) };
                createStorage().trySet(old);
                const next = { version: 2, items: [{ id: 'item-1', label: 'Changed' }, ...items(4).slice(3)] };
                return { old, next, final: old, refuse: (key) => key === INDEX_KEY };
            },
        ],
        [
            'migrates, is refused for quota, and writes the legacy value whole instead',
            () => {
                const old = bigLegacyValue(1);
                localStorage.setItem(LEGACY_KEY, stringify(old));
                const next = bigLegacyValue(2);
                return { old, next, final: next, refuse: (key) => key === `${PART_PREFIX}item-2` };
            },
        ],
    ])('never reads a mix of two values at any step of a commit that %s', (_, arrange) => {
        const { old, next, final, refuse } = arrange();

        const reads = readAtEveryStepOf(() => {
            const writer = createStorage();
            writer.get();
            writer.trySet(next);
        }, refuse);

        expect(reads.length).toBeGreaterThan(2);
        const outcomes = reads.map(
            ({ adapter, value }) => value ?? (adapter.trySet(next) ? 'empty and writable' : 'refused')
        );
        for (const outcome of outcomes) {
            expect([old, next, 'refused']).toContainEqual(outcome);
        }
        expect(outcomes.at(-1)).toEqual(final);
    });

    it('never pairs parts of two commits another writer made while it read', () => {
        const old = { version: 1, items: items(3) };
        const theirs = createStorage();
        theirs.trySet(old);
        const afterFirst = { ...old, items: old.items.with(0, { id: 'item-0', label: 'First' }) };
        const afterSecond = { ...afterFirst, items: afterFirst.items.with(1, { id: 'item-1', label: 'Second' }) };
        const getItem = Storage.prototype.getItem;
        let committing = false;
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
            const text = getItem.call(this, key);
            if (!committing && key === `${PART_PREFIX}item-0`) {
                committing = true;
                theirs.trySet(afterFirst);
                theirs.trySet(afterSecond);
            }
            return text;
        });

        const reader = createStorage();
        expect(reader.get()).toBeNull();
        vi.restoreAllMocks();

        expect(reader.trySet(old)).toBe(false);
        expect(createStorage().get()).toEqual(afterSecond);
    });

    it('drops a part a commit that stopped before its index left behind, once that commit cannot still be running', () => {
        const old = { version: 1, items: items(3) };
        createStorage().trySet(old);
        const next = { version: 2, items: old.items.map((item) => ({ ...item, label: 'Changed' })) };
        const states = recordStatesAfterEachWrite(() => {
            const writer = createStorage();
            writer.get();
            writer.trySet(next);
        });
        restoreStoredState(states[0]!);

        expect(createStorage().get()).toBeNull();

        vi.useFakeTimers({ now: Date.now() + 60 * 60 * 1000, toFake: ['Date'] });
        const warn = vi.spyOn(logger, 'warn');
        const storage = createStorage();
        expect(storage.get()).toEqual({ version: 1, items: old.items.slice(1) });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(storage.trySet(old)).toBe(true);
        expect(createStorage().get()).toEqual(old);
    });

    it('rewrites a committed part once another writer announces it changed that part', () => {
        const storage = createStorage();
        const value = { version: 1, items: items(3) };
        storage.trySet(value);
        localStorage.setItem(`${PART_PREFIX}item-1`, stringify({ id: 'item-1', label: 'Theirs' }));
        announceOtherWriter(`${PART_PREFIX}item-1`);

        expect(storage.trySet({ ...value, version: 2 })).toBe(true);

        expect(createStorage().get()).toEqual({ ...value, version: 2 });
    });

    it.each([INDEX_KEY, null])(
        'rewrites every committed part once another writer announces a change to %s',
        (announcedKey) => {
            const storage = createStorage();
            const value = { version: 1, items: items(2) };
            storage.trySet(value);
            for (const key of storedPartKeys()) {
                localStorage.removeItem(key);
            }
            announceOtherWriter(announcedKey);

            expect(storage.trySet({ ...value, version: 2 })).toBe(true);

            expect(createStorage().get()).toEqual({ ...value, version: 2 });
        }
    );

    it('frees the parts a write evicts before writing the parts it adds', () => {
        const big = (id: string) => ({ id, label: id.repeat(5_000) });
        const storage = createStorage();
        const atBound = { version: 1, items: [big('item-0'), big('item-1'), big('item-2')] };
        storage.trySet(atBound);
        // Room for the index to change, never for a fourth part beside the three stored.
        refuseWritesPast(usedUnits(localStorage) + 1_000);

        const added = { version: 1, items: [...atBound.items.slice(1), big('item-3')] };
        expect(storage.trySet(added)).toBe(true);

        vi.restoreAllMocks();
        expect(createStorage().get()).toEqual(added);
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
