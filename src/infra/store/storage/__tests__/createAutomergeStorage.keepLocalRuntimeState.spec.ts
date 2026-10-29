import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStoragePreview,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
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

function createOptedInRuntimeStorage(): ReturnType<typeof createAutomergeStorage<Transport>> {
    return createAutomergeStorage<Transport>('root', 'state', {
        toCrdt: ({ tempo }) => ({ tempo, playing: false }),
        fromCrdt: (raw) => ({ ...DEFAULT_TRANSPORT, tempo: raw.tempo }),
        hydrateMissing: () => DEFAULT_TRANSPORT,
        isLocalRuntimeStateUpdate: ({ currentValue, nextValue }) => currentValue.tempo === nextValue.tempo,
        preserveLocalRuntimeStateOnRecompute: true,
        projectCommittedLocalState: ({ authorityValue, localValue }) => ({
            ...authorityValue,
            playing: localValue.playing,
        }),
    });
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

    it('projects opted-in local updates silently without a pending write, then carries them over a foreign abort', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createOptedInRuntimeStorage();
        storage.hydrate?.();
        const notify = vi.fn();
        storage.subscribe?.(notify);
        const raw = structuredClone(doc);

        storage.set({ tempo: 90, playing: true });
        expect(storage.get()).toEqual({ tempo: 90, playing: true });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(doc).toEqual(raw);
        expect(notify).not.toHaveBeenCalled();

        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ tempo: 120, playing: false });
        });
        expect(foreign.status).toBe('returned');
        expect(countPendingAutomergeStorageWrites()).toBe(1);
        storage.set({ tempo: 120, playing: true });
        expect(countPendingAutomergeStorageWrites()).toBe(1);
        expect(notify).not.toHaveBeenCalled();
        foreign.abort();
        expect(storage.get()).toEqual({ tempo: 90, playing: true });
        expect(doc).toEqual(raw);
        expect(notify).toHaveBeenCalledTimes(1);

        storage.setProjected?.({ tempo: 90, playing: false });
        expect(storage.get()).toEqual({ tempo: 90, playing: false });
        expect(notify).toHaveBeenCalledTimes(2);
    });

    it('keeps the existing pending-write behavior for an adapter without the new opt-in', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createRuntimeKeepingStorage();
        storage.hydrate?.();

        storage.set({ tempo: 90, playing: true });

        expect(countPendingAutomergeStorageWrites()).toBe(1);
        flushAutomergeStorageWrites();
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('keeps local fields on an opted-in commit but resets them for a new project', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createOptedInRuntimeStorage();
        storage.hydrate?.();
        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ tempo: 120, playing: false });
        });
        expect(foreign.status).toBe('returned');
        storage.set({ tempo: 120, playing: true });

        foreign.commit();

        expect(storage.get()).toEqual({ tempo: 120, playing: true });
        expect(doc.state).toEqual({ tempo: 120, playing: false });
        expect(countPendingAutomergeStorageWrites()).toBe(0);

        resetAutomergeStorageProjections('root');
        expect(storage.get()).toEqual(DEFAULT_TRANSPORT);
    });

    it('commits an earlier owner local view without a later provisional runtime field', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createOptedInRuntimeStorage();
        storage.hydrate?.();
        storage.set({ tempo: 90, playing: true });
        const earlier = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ tempo: 120, playing: true });
        });
        const later = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ tempo: 150, playing: false });
        });
        earlier.commit();
        expect(storage.get()).toEqual({ tempo: 150, playing: false });
        later.abort();
        expect(storage.get()).toEqual({ tempo: 120, playing: true });
        expect(doc.state).toEqual({ tempo: 120, playing: false });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('retains only local fields through absent-port deferred owner terminals', () => {
        const storage = createOptedInRuntimeStorage();
        storage.set({ tempo: 90, playing: false });
        flushAutomergeStorageWrites();
        expect(storage.get()).toEqual({ tempo: 90, playing: false });
        expect(countPendingAutomergeStorageWrites()).toBe(0);

        storage.set({ tempo: 90, playing: true });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        const aborted = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ tempo: 120, playing: false });
        });
        storage.set({ tempo: 120, playing: true });
        aborted.abort();
        expect(storage.get()).toEqual({ tempo: 90, playing: true });
        expect(countPendingAutomergeStorageWrites()).toBe(0);

        const deferred = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ tempo: 150, playing: false });
        });
        storage.set({ tempo: 150, playing: true });
        deferred.commit();
        expect(storage.get()).toEqual({ tempo: 150, playing: true });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });

    it('keeps preview updates isolated and refuses a settled scope before a local projection', () => {
        const doc: TestDoc = { state: { tempo: 90 } };
        configureTestPort(doc);
        const storage = createOptedInRuntimeStorage();
        storage.hydrate?.();
        const raw = structuredClone(doc);
        const notify = vi.fn();
        storage.subscribe?.(notify);
        const preview = createAutomergeStoragePreview(
            new Map([['root', Automerge.from<{ state: { tempo: number } }>({ state: { tempo: 90 } })]])
        );
        try {
            preview.scope(() => {
                storage.set({ tempo: 90, playing: true });
                expect(storage.get()).toEqual({ tempo: 90, playing: true });
            });
        } finally {
            preview.release();
        }
        expect(storage.get()).toEqual({ tempo: 90, playing: false });
        expect(doc).toEqual(raw);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(notify).not.toHaveBeenCalled();

        let closedScope: (callback: () => void) => void = () => {
            throw new Error('Expected a captured transaction scope');
        };
        const transaction = runWithAutomergeStorageTransaction(undefined, (scope) => {
            closedScope = scope;
        });
        transaction.abort();
        expect(() => closedScope(() => storage.set({ tempo: 90, playing: true }))).toThrow(/already settled/);
        expect(storage.get()).toEqual({ tempo: 90, playing: false });
        expect(doc).toEqual(raw);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(notify).not.toHaveBeenCalled();

        storage.set(null);
        expect(countPendingAutomergeStorageWrites()).toBe(1);
        flushAutomergeStorageWrites();
        expect(storage.get()).toBeNull();
    });
});
