import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

/**
 * A hydrate that re-projects the open project keeps the runtime fields an
 * adapter declares local through `projectCommittedLocalState`, the contract the
 * commit path already honours. A hydrate without the option is a project load
 * and starts every field from the document and the store's defaults.
 */

type TestDoc = { [key: string]: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;
type Transport = { tempo: number; playing: boolean };

const DEFAULT_TRANSPORT: Transport = { tempo: 120, playing: false };

function configureTestPort(doc: TestDoc): void {
    let headsCounter = 0;
    const port: TestPort = {
        getDoc: () => doc,
        getDocHeads: () => [`head-${headsCounter++}`],
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(doc);
        },
    };
    configureAutomergeStoragePort(port);
}

// The store's own sanitizer rebuilds a state from defaults, so the guard the
// adapter runs on inbound values drops the runtime field before it is restored.
function createRuntimeKeepingStorage(): ReturnType<typeof createAutomergeStorage<Transport>> {
    const storage = createAutomergeStorage<Transport>('root', 'state', {
        toCrdt: ({ tempo }) => ({ tempo, playing: false }),
        fromCrdt: (raw) => ({ ...DEFAULT_TRANSPORT, tempo: raw.tempo }),
        hydrateMissing: () => DEFAULT_TRANSPORT,
        projectCommittedLocalState: ({ authorityValue, localValue }) => ({
            ...authorityValue,
            playing: localValue.playing,
        }),
    });
    storage.registerInboundProjector?.(({ value }) => (value === null ? null : { ...value, playing: false }));
    return storage;
}

describe('createAutomergeStorage hydrate with keepLocalRuntimeState', () => {
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

    it('starts every field from the document and defaults when the hydrate is a project load', () => {
        configureTestPort({ state: { tempo: 90 } });
        const storage = createRuntimeKeepingStorage();
        storage.hydrate?.();
        storage.set({ tempo: 90, playing: true });
        flushAutomergeStorageWrites();

        storage.hydrate?.({});

        expect(storage.get()).toEqual({ tempo: 90, playing: false });
    });

    it('keeps the local runtime field and takes the durable field from the document', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createRuntimeKeepingStorage();
        storage.hydrate?.();
        storage.set({ tempo: 90, playing: true });
        flushAutomergeStorageWrites();
        doc.state = { tempo: 150 };

        const changed = storage.hydrate?.({ keepLocalRuntimeState: true });

        expect(changed).toBe(true);
        expect(storage.get()).toEqual({ tempo: 150, playing: true });
    });

    it('keeps the local runtime field while a local write is still pending', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createRuntimeKeepingStorage();
        storage.hydrate?.();
        storage.set({ tempo: 90, playing: true });
        doc.state = { tempo: 150 };

        storage.hydrate?.({ keepLocalRuntimeState: true });

        expect(storage.get()?.playing).toBe(true);
    });

    it('keeps the local runtime field in the committed value a discarded pending write falls back to', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createRuntimeKeepingStorage();
        storage.hydrate?.();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ tempo: 90, playing: true });
        });
        doc.state = { tempo: 150 };
        storage.hydrate?.({ keepLocalRuntimeState: true });

        transaction.abort();

        expect(storage.get()).toEqual({ tempo: 150, playing: true });
    });

    it('hydrates a store that holds no value yet from the document alone', () => {
        configureTestPort({ state: { tempo: 150 } });
        const storage = createRuntimeKeepingStorage();

        storage.hydrate?.({ keepLocalRuntimeState: true });

        expect(storage.get()).toEqual({ tempo: 150, playing: false });
    });

    it('leaves a value its inbound guard rejected rejected', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createRuntimeKeepingStorage();
        storage.hydrate?.();
        storage.set({ tempo: 90, playing: true });
        flushAutomergeStorageWrites();
        storage.registerInboundProjector?.(() => null);
        doc.state = { tempo: 150 };

        storage.hydrate?.({ keepLocalRuntimeState: true });

        expect(storage.get()).toBeNull();
    });

    it('keeps the local runtime field when the document has no slot for the store', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createRuntimeKeepingStorage();
        storage.hydrate?.();
        storage.set({ tempo: 90, playing: true });
        flushAutomergeStorageWrites();
        delete doc.state;

        storage.hydrate?.({ keepLocalRuntimeState: true });

        expect(storage.get()).toEqual({ tempo: 120, playing: true });
    });

    it('hydrates an adapter that declares no local runtime state as it would without the option', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createAutomergeStorage<Transport>('root', 'state', {
            fromCrdt: (raw) => ({ ...DEFAULT_TRANSPORT, tempo: raw.tempo }),
        });
        storage.hydrate?.();
        storage.set({ tempo: 90, playing: true });
        flushAutomergeStorageWrites();
        doc.state = { tempo: 150 };

        const changed = storage.hydrate?.({ keepLocalRuntimeState: true });

        expect(changed).toBe(true);
        expect(storage.get()).toEqual({ tempo: 150, playing: false });
    });
});
