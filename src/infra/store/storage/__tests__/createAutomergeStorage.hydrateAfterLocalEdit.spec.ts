import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '../createAutomergeStorage';

type Slot = {
    tempo: number;
    metronome: boolean;
    rows: string[];
    loopEnd: number | null;
    playing: boolean;
};

type TestDoc = { slot?: Slot };
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
});
