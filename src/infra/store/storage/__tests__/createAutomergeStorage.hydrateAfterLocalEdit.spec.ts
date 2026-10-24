import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type Slot = {
    tempo: number;
    metronome: boolean;
    rows: string[];
    loopEnd: number | null;
    playing: boolean;
};

type Range = { low: number; high: number; note: string };

type TestDoc = { slot?: Slot; range?: Range };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const durableSlot: Slot = { tempo: 110, metronome: false, rows: ['a'], loopEnd: 8, playing: false };

/** A fresh slot each call: the port's flush reconciles into the document slot in place. */
function slot(overrides: Partial<Slot> = {}): Slot {
    return { ...durableSlot, rows: [...durableSlot.rows], ...overrides };
}

function createTestPort(initialDoc: TestDoc, mutateDoc?: TestPort['mutateDoc']): { doc: TestDoc; port: TestPort } {
    const doc = initialDoc;
    return {
        doc,
        port: {
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: mutateDoc ?? (({ changeFn }) => changeFn(doc)),
        },
    };
}

/** Runtime `playing` never reaches the document; a document read starts it from the default. */
const slotOptions = {
    toCrdt: ({ tempo, metronome, rows, loopEnd }: Slot) => ({ tempo, metronome, rows, loopEnd }),
    fromCrdt: (value: Slot): Slot => ({ ...durableSlot, ...value, playing: false }),
};

function createSlotStorage() {
    return createAutomergeStorage<Slot>('root', 'slot', { ...slotOptions, hydrateMissing: slot });
}

/** The transport keeps `playing` through a re-projection of the open project. */
function createRuntimeSlotStorage() {
    return createAutomergeStorage<Slot>('root', 'slot', {
        ...slotOptions,
        hydrateMissing: slot,
        projectCommittedLocalState: ({ authorityValue, localValue }) => ({
            ...authorityValue,
            playing: localValue.playing,
        }),
    });
}

function readSlot(storage: ReturnType<typeof createSlotStorage>): Slot {
    const value = storage.get();
    if (!value) {
        throw new Error('Expected the store to hold a value');
    }
    return value;
}

describe('createAutomergeStorage hydrate after a local edit', () => {
    let frameCallback: FrameRequestCallback | null;

    beforeEach(() => {
        frameCallback = null;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            frameCallback = callback;
            return 1;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        resetAutomergeStorageProjections('root');
        configureAutomergeStoragePort(null);
        flushAutomergeStorageWrites();
        vi.unstubAllGlobals();
    });

    describe('remembering the last hydrated document', () => {
        it('projects a document equal to the last hydrated one after a local commit replaced it', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            expect(storage.hydrate?.()).toBe(true);

            storage.set({ ...readSlot(storage), tempo: 97 });
            flushAutomergeStorageWrites();
            expect(readSlot(storage).tempo).toBe(97);

            doc.slot = slot();

            expect(storage.hydrate?.()).toBe(true);
            expect(readSlot(storage).tempo).toBe(110);
        });

        it('projects a document equal to the last hydrated one after a refused write read other authority', () => {
            let refuseWrites = false;
            const { doc, port } = createTestPort({ slot: slot() }, ({ changeFn }) => {
                if (refuseWrites) {
                    throw new AutomergeStorageWriteConflictError('refused');
                }
                changeFn(doc);
            });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            expect(storage.hydrate?.()).toBe(true);

            doc.slot = slot({ tempo: 120 });
            refuseWrites = true;
            storage.set({ ...readSlot(storage), tempo: 97 });
            expect(() => flushAutomergeStorageWrites()).toThrow('refused');
            expect(readSlot(storage).tempo).toBe(120);

            refuseWrites = false;
            doc.slot = slot();

            expect(storage.hydrate?.()).toBe(true);
            expect(readSlot(storage).tempo).toBe(110);
        });

        it('projects a document equal to the last hydrated one after a write was deferred without a port', () => {
            const { port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            expect(storage.hydrate?.()).toBe(true);

            configureAutomergeStoragePort(null);
            storage.set({ ...readSlot(storage), tempo: 97 });
            frameCallback?.(100);
            expect(readSlot(storage).tempo).toBe(97);

            configureAutomergeStoragePort(port);

            expect(storage.hydrate?.()).toBe(true);
            expect(readSlot(storage).tempo).toBe(110);
        });

        it('still skips a document that has not changed since the last hydrate', () => {
            const { port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            expect(storage.hydrate?.()).toBe(true);

            expect(storage.hydrate?.()).toBe(false);
        });
    });

    describe('rebasing a pending write over the document', () => {
        it('keeps the scalars the write changed and takes every other field from the document', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            storage.hydrate?.();

            storage.set({ ...readSlot(storage), metronome: true });
            doc.slot = slot({ tempo: 150 });

            expect(storage.hydrate?.()).toBe(true);
            expect(readSlot(storage)).toMatchObject({ metronome: true, tempo: 150 });

            flushAutomergeStorageWrites();
            expect(doc.slot).toMatchObject({ metronome: true, tempo: 150 });
        });

        it('keeps a scalar the write changed over a document that changed the same scalar', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            storage.hydrate?.();

            storage.set({ ...readSlot(storage), tempo: 100 });
            doc.slot = slot({ tempo: 150 });
            storage.hydrate?.();
            flushAutomergeStorageWrites();

            expect(doc.slot?.tempo).toBe(100);
            expect(readSlot(storage).tempo).toBe(100);
        });

        it('flushes only the fields the write changed, not the ones the document changed', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            storage.hydrate?.();

            storage.set({ ...readSlot(storage), metronome: true });
            doc.slot = slot({ tempo: 150 });
            storage.hydrate?.();
            doc.slot = slot({ tempo: 200 });
            flushAutomergeStorageWrites();

            expect(doc.slot).toMatchObject({ metronome: true, tempo: 200 });
        });

        it('keeps a scalar the write cleared to null', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            storage.hydrate?.();

            storage.set({ ...readSlot(storage), loopEnd: null });
            doc.slot = slot({ loopEnd: 16, tempo: 150 });
            storage.hydrate?.();

            expect(readSlot(storage)).toMatchObject({ loopEnd: null, tempo: 150 });
        });

        // Both sides changed the same nested field: the document wins, a limit filed as issue 5521.
        it('takes a nested field from the document even when the write changed it', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            storage.hydrate?.();

            storage.set({ ...readSlot(storage), metronome: true, rows: ['a', 'local'] });
            doc.slot = slot({ rows: ['a', 'remote'] });
            storage.hydrate?.();

            expect(readSlot(storage)).toMatchObject({ metronome: true, rows: ['a', 'remote'] });
        });

        it('keeps a nested field the write changed when the document did not change it', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createRuntimeSlotStorage();
            storage.hydrate?.({ keepLocalRuntimeState: true });

            storage.set({ ...readSlot(storage), playing: true });
            flushAutomergeStorageWrites();
            storage.set({ ...readSlot(storage), rows: ['a', 'local'] });

            storage.hydrate?.({ keepLocalRuntimeState: true });
            expect(readSlot(storage)).toMatchObject({ playing: true, rows: ['a', 'local'] });

            flushAutomergeStorageWrites();
            expect(doc.slot?.rows).toEqual(['a', 'local']);
            expect(readSlot(storage).rows).toEqual(['a', 'local']);
        });

        it('keeps a nested field the write changed when the document changed a different field', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createRuntimeSlotStorage();
            storage.hydrate?.({ keepLocalRuntimeState: true });

            storage.set({ ...readSlot(storage), rows: ['a', 'local'] });
            doc.slot = slot({ tempo: 150 });
            storage.hydrate?.({ keepLocalRuntimeState: true });
            expect(readSlot(storage)).toMatchObject({ tempo: 150, rows: ['a', 'local'] });

            flushAutomergeStorageWrites();
            expect(doc.slot).toMatchObject({ tempo: 150, rows: ['a', 'local'] });
        });

        it('takes a nested field the write did not change from the document', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createRuntimeSlotStorage();
            storage.hydrate?.({ keepLocalRuntimeState: true });

            storage.set({ ...readSlot(storage), metronome: true });
            doc.slot = slot({ rows: ['a', 'remote'] });
            storage.hydrate?.({ keepLocalRuntimeState: true });

            expect(readSlot(storage)).toMatchObject({ metronome: true, rows: ['a', 'remote'] });
        });

        it('leaves a runtime field to the document on a hydrate that does not keep local runtime state', () => {
            const { doc, port } = createTestPort({ slot: slot() });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            storage.hydrate?.();

            storage.set({ ...readSlot(storage), playing: true, metronome: true });
            doc.slot = slot({ tempo: 150 });
            storage.hydrate?.();

            expect(readSlot(storage)).toMatchObject({ playing: false, metronome: true, tempo: 150 });
        });

        it('takes the whole document when the write has no known base', () => {
            const { doc, port } = createTestPort({ slot: slot({ tempo: 150 }) });
            configureAutomergeStoragePort(port);
            const storage = createAutomergeStorage<Slot>('root', 'slot', slotOptions);

            storage.set(slot({ metronome: true }));
            expect(storage.hydrate?.()).toBe(true);
            expect(readSlot(storage)).toMatchObject({ tempo: 150, metronome: false });

            doc.slot = slot({ tempo: 200 });
            flushAutomergeStorageWrites();

            expect(doc.slot).toMatchObject({ tempo: 200, metronome: false });
        });

        it('takes the whole document when the write was derived from a deferred baseline', () => {
            const storage = createSlotStorage();
            storage.set(slot({ tempo: 97 }));
            frameCallback?.(100);
            const { doc, port } = createTestPort({ slot: slot({ tempo: 150 }) });
            configureAutomergeStoragePort(port);

            storage.set({ ...readSlot(storage), metronome: true });
            expect(storage.hydrate?.()).toBe(true);
            expect(readSlot(storage)).toMatchObject({ tempo: 150, metronome: false });

            doc.slot = slot({ tempo: 200 });
            flushAutomergeStorageWrites();

            expect(doc.slot).toMatchObject({ tempo: 200, metronome: false });
        });
    });

    describe('rebasing the pending writes behind a refused write', () => {
        it('keeps a later write on the rule a hydrate follows and re-anchors it at the document', () => {
            let refuseWrites = false;
            const { doc, port } = createTestPort({ slot: slot() }, ({ changeFn }) => {
                if (refuseWrites) {
                    throw new AutomergeStorageWriteConflictError('refused');
                }
                changeFn(doc);
            });
            configureAutomergeStoragePort(port);
            const storage = createSlotStorage();
            storage.hydrate?.();

            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ ...readSlot(storage), tempo: 97 });
            });
            storage.set({ ...readSlot(storage), metronome: true });
            doc.slot = slot({ tempo: 120 });
            refuseWrites = true;
            expect(() => transaction.commit()).toThrow('refused');
            transaction.abort();
            refuseWrites = false;
            expect(readSlot(storage)).toMatchObject({ tempo: 120, metronome: true });

            doc.slot = slot({ tempo: 130 });
            expect(storage.hydrate?.()).toBe(true);
            flushAutomergeStorageWrites();

            expect(doc.slot).toMatchObject({ tempo: 130, metronome: true });
            expect(readSlot(storage)).toMatchObject({ tempo: 130, metronome: true });
        });

        it('takes the whole document for a later write derived from a deferred baseline behind a refused write', () => {
            let refuseWrites = false;
            const { doc, port } = createTestPort({ slot: slot({ tempo: 150 }) }, ({ changeFn }) => {
                if (refuseWrites) {
                    throw new AutomergeStorageWriteConflictError('refused');
                }
                changeFn(doc);
            });
            const storage = createSlotStorage();
            storage.set(slot({ tempo: 97 }));
            frameCallback?.(100);
            configureAutomergeStoragePort(port);

            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ ...readSlot(storage), loopEnd: 16 });
            });
            storage.set({ ...readSlot(storage), metronome: true });
            refuseWrites = true;
            expect(() => transaction.commit()).toThrow('refused');
            transaction.abort();
            refuseWrites = false;
            expect(readSlot(storage)).toMatchObject({ tempo: 150, metronome: false });

            flushAutomergeStorageWrites();
            expect(doc.slot).toMatchObject({ tempo: 150, metronome: false });
        });
    });

    // A store's inbound guard can enforce a rule across fields (the transport
    // resets an inverted loop pair to defaults). Each side's edit can be valid
    // alone while the per-field merge of both is not, and a rebase must never
    // author what the guard rebuilt from defaults: it falls back to the document.
    describe('rebasing a pending write whose merge the inbound guard would change', () => {
        const durableRange: Range = { low: 0, high: 16, note: '' };

        /** A fresh slot each call: the port's flush reconciles into the document slot in place. */
        function rangeDoc(): TestDoc {
            return { range: { low: 0, high: 16, note: '' } };
        }

        function createRangeStorage() {
            const storage = createAutomergeStorage<Range>('root', 'range', {
                toCrdt: ({ low, high, note }) => ({ low, high, note }),
                hydrateMissing: () => durableRange,
            });
            storage.registerInboundProjector?.(({ value }) =>
                value !== null && value.low > value.high ? { ...value, low: 0, high: 0 } : value
            );
            return storage;
        }

        function readRange(storage: ReturnType<typeof createRangeStorage>): Range {
            const value = storage.get();
            if (!value) {
                throw new Error('Expected the store to hold a value');
            }
            return value;
        }

        it('keeps the document when the merged fields break the rule on a hydrate', () => {
            const doc = rangeDoc();
            configureAutomergeStoragePort(createTestPort(doc).port);
            const storage = createRangeStorage();
            storage.hydrate?.();

            storage.set({ ...readRange(storage), high: 12 });
            doc.range = { ...durableRange, low: 14 };
            expect(storage.hydrate?.()).toBe(true);
            flushAutomergeStorageWrites();

            expect(doc.range).toMatchObject({ low: 14, high: 16 });
            expect(readRange(storage)).toMatchObject({ low: 14, high: 16 });
        });

        it('keeps a local edit that leaves the rule satisfied beside a document change', () => {
            const doc = rangeDoc();
            configureAutomergeStoragePort(createTestPort(doc).port);
            const storage = createRangeStorage();
            storage.hydrate?.();

            storage.set({ ...readRange(storage), high: 20, note: 'kept' });
            doc.range = { ...durableRange, low: 14 };
            storage.hydrate?.();
            flushAutomergeStorageWrites();

            expect(doc.range).toMatchObject({ low: 14, high: 20, note: 'kept' });
            expect(readRange(storage)).toMatchObject({ low: 14, high: 20, note: 'kept' });
        });

        it('keeps the document for a later write behind a refused write', () => {
            let refuseWrites = false;
            const doc = rangeDoc();
            const { port } = createTestPort(doc, ({ changeFn }) => {
                if (refuseWrites) {
                    throw new AutomergeStorageWriteConflictError('refused');
                }
                changeFn(doc);
            });
            configureAutomergeStoragePort(port);
            const storage = createRangeStorage();
            storage.hydrate?.();

            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ ...readRange(storage), note: 'refused' });
            });
            storage.set({ ...readRange(storage), high: 12 });
            doc.range = { ...durableRange, low: 14 };
            refuseWrites = true;
            expect(() => transaction.commit()).toThrow('refused');
            transaction.abort();
            refuseWrites = false;
            expect(readRange(storage)).toMatchObject({ low: 14, high: 16 });

            flushAutomergeStorageWrites();

            expect(doc.range).toMatchObject({ low: 14, high: 16 });
            expect(readRange(storage)).toMatchObject({ low: 14, high: 16 });
        });
    });
});
