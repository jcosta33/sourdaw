import { change, clone, decodeChange, from, getActorId, getLastLocalChange, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';

import {
    appendAutomergeStoragePublicationMetadata,
    AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY,
    captureAutomergeStoragePreparationScope,
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '../createAutomergeStorage';

type Document = { state: { count: number }; checkpoint: { records: string[] }; other: number; [key: string]: unknown };
type Port = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;
let document: Doc<Document>;
let message: string;
let reused: boolean[];
let ordinaryCalls: number;
let descriptions: unknown[];

beforeEach(() => {
    document = from<Document>({ state: { count: 0 }, checkpoint: { records: [] }, other: 0 });
    message = 'Detect transients';
    reused = [];
    ordinaryCalls = 0;
    descriptions = [];
    const candidates = new WeakMap<object, Doc<Document>>();
    const port: Port = {
        getDoc: () => document,
        hasDoc: () => true,
        getSemanticMessage: () => message,
        mutateDoc: (input) => {
            ordinaryCalls++;
            document = change(document, { message: input.message }, input.changeFn);
        },
        cloneDocForMutation: (input) => {
            descriptions.push(input.canonicalMutation);
            const original = document;
            const copied = clone(document, { actor: getActorId(document) });
            let discarded = false;
            return {
                isCurrent: () => !discarded && document === original,
                discard: () => {
                    discarded = true;
                },
                materialize: () => {
                    const candidate = change(copied, { message: input.message }, input.changeFn);
                    const token = {};
                    candidates.set(token, candidate);
                    return {
                        token,
                        isCurrent: () => !discarded && document === original && candidates.has(token),
                        discard: () => {
                            candidates.delete(token);
                            discarded = true;
                        },
                    };
                },
            };
        },
        mutateDocValidated: (input) => {
            reused.push(input.preparedCandidate !== undefined);
            let candidate: Doc<Document>;
            if (input.preparedCandidate) {
                const prepared = candidates.get(input.preparedCandidate);
                if (!prepared) {
                    throw new Error('Missing prepared candidate');
                }
                candidate = prepared;
            } else {
                candidate = change(
                    clone(document, { actor: getActorId(document) }),
                    { message: input.message },
                    input.changeFn
                );
            }
            input.validateDocument(candidate);
            input.beforePublication();
            document = candidate;
            input.onPublished();
        },
    };
    configureAutomergeStoragePort(port);
});
afterEach(() => {
    flushAutomergeStorageWrites();
    configureAutomergeStoragePort(null);
});

function prepare() {
    const storage = createAutomergeStorage<{ count: number }>('root', 'state');
    storage.hydrate?.();
    const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    const plan = storage.prepareSet?.(transaction.value, { count: 1 });
    if (!plan) {
        throw new Error('Expected eligible preparation');
    }
    return { storage, transaction, plan };
}
function stage(prepared: ReturnType<typeof prepare>) {
    prepared.plan.clone();
    prepared.plan.materialize();
    expect(prepared.transaction.scope(prepared.plan.stage)).toBe(true);
    prepared.transaction.validateDocument('root', (candidate) =>
        candidate.state !== undefined ? null : 'missing state'
    );
}

describe('invisible conditional Automerge preparation', () => {
    it('does not stage cache, pending writes or live actor state in either private phase', () => {
        const original = document;
        const before = countPendingAutomergeStorageWrites();
        const prepared = prepare();
        expect(prepared.storage.get()).toEqual({ count: 0 });
        prepared.plan.clone();
        expect(document).toBe(original);
        expect(countPendingAutomergeStorageWrites()).toBe(before);
        prepared.plan.materialize();
        expect(document).toBe(original);
        expect(prepared.storage.get()).toEqual({ count: 0 });
        expect(countPendingAutomergeStorageWrites()).toBe(before);
        expect(ordinaryCalls).toBe(0);
        expect(prepared.transaction.scope(prepared.plan.stage)).toBe(true);
        message = 'unrelated command';
        prepared.transaction.validateDocument('root', () => null);
        prepared.transaction.commit();
        expect(reused).toEqual([true]);
        expect(document.state).toEqual({ count: 1 });
        const last = getLastLocalChange(document);
        if (!last) {
            throw new Error('Missing real change');
        }
        expect(decodeChange(last).message).toBe('Detect transients');
        expect(prepared.plan.stage()).toBe(false);
    });

    it.each(['metadata', 'checkpoint', 'coalesced value', 'message'] as const)(
        'retains the complete actual group after late %s',
        (kind) => {
            const prepared = prepare();
            stage(prepared);
            prepared.transaction.scope(() => {
                if (kind === 'metadata') {
                    appendAutomergeStoragePublicationMetadata('root', { kind: 'late', member: 7 });
                } else if (kind === 'checkpoint') {
                    const checkpoint = createAutomergeStorage<{ records: string[] }>('root', 'checkpoint');
                    checkpoint.hydrate?.();
                    checkpoint.set({ records: ['actual late checkpoint'] });
                } else if (kind === 'message') {
                    message = 'Actual late message';
                    prepared.storage.set({ count: 1 });
                } else {
                    prepared.storage.set({ count: 2 });
                }
            });
            prepared.transaction.commit();
            expect(reused).toEqual([false]);
            expect(document.state.count).toBe(kind === 'coalesced value' ? 2 : 1);
            if (kind === 'metadata') {
                expect(document[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([{ kind: 'late', member: 7 }]);
            }
            if (kind === 'checkpoint') {
                expect(document.checkpoint.records).toEqual(['actual late checkpoint']);
            }
            if (kind === 'message') {
                const bytes = getLastLocalChange(document);
                if (!bytes) throw new Error('Expected complete actual change');
                // The existing first-write message contract survives complete fallback.
                expect(decodeChange(bytes).message).toBe('Detect transients');
            }
        }
    );

    it('uses the complete actual callback when real Store.set notification adds a checkpoint and metadata', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        storage.hydrate?.();
        const store = createStore({ storage, initialData: { count: 0 } });
        const checkpoint = createAutomergeStorage<{ records: string[] }>('root', 'checkpoint');
        checkpoint.hydrate?.();
        const release = store.subscribe(() => {
            checkpoint.set({ records: ['subscriber checkpoint'] });
            appendAutomergeStoragePublicationMetadata('root', { kind: 'subscriber' });
        });
        const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
        if (transaction.status !== 'returned') throw transaction.error;
        const plan = storage.prepareSet?.(transaction.value, { count: 1 }, (value) => store.set(value));
        if (!plan) throw new Error('Expected preparation');
        const before = document;
        plan.clone();
        plan.materialize();
        expect(document).toBe(before);
        expect(transaction.scope(plan.stage)).toBe(true);
        transaction.validateDocument('root', () => null);
        transaction.commit();
        release();
        expect(reused).toEqual([false]);
        expect(document.state).toEqual({ count: 1 });
        expect(document.checkpoint.records).toEqual(['subscriber checkpoint']);
        expect(document[AUTOMERGE_STORAGE_PUBLICATION_EVIDENCE_KEY]).toEqual([{ kind: 'subscriber' }]);
    });

    it('keeps custom identity callbacks on the complete ordinary preparation route', () => {
        const storage = createAutomergeStorage<{ count: number }>('root', 'state', {
            crdtEntityIdentity: { rows: (row) => (typeof row.id === 'string' ? row.id : null) },
        });
        storage.hydrate?.();
        const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
        if (transaction.status !== 'returned') throw transaction.error;
        const plan = storage.prepareSet?.(transaction.value, { count: 1 });
        if (!plan) throw new Error('Expected complete local fallback');
        plan.clone();
        expect(descriptions).toEqual([undefined]);
        expect(plan.requestMaterialization).toBeUndefined();
        plan.materialize();
        expect(transaction.scope(plan.stage)).toBe(true);
        transaction.validateDocument('root', () => null);
        transaction.commit();
        expect(document.state).toEqual({ count: 1 });
    });

    it('returns stale before staging when an independent pending write changes its future revision', () => {
        const prepared = prepare();
        prepared.plan.clone();
        prepared.plan.materialize();
        prepared.storage.set({ count: 9 });
        expect(prepared.plan.isCurrent()).toBe(false);
        expect(prepared.transaction.scope(prepared.plan.stage)).toBe(false);
        expect(document.state.count).toBe(0);
        expect(prepared.storage.get()).toEqual({ count: 9 });
        prepared.plan.discard();
        prepared.transaction.abort();
        flushAutomergeStorageWrites();
        expect(document.state.count).toBe(9);
    });

    it('does not hide a real authority race with the ordinary delegate', () => {
        const prepared = prepare();
        stage(prepared);
        document = change(document, (draft) => {
            draft.other = 7;
        });
        expect(() => prepared.transaction.commit()).toThrow('authority changed');
        prepared.transaction.abort();
        expect(reused).toEqual([]);
        expect(document.state.count).toBe(0);
        expect(document.other).toBe(7);
    });

    it('propagates the full validator failure without recomputing a second candidate', () => {
        const prepared = prepare();
        const original = document;
        prepared.plan.clone();
        prepared.plan.materialize();
        expect(prepared.transaction.scope(prepared.plan.stage)).toBe(true);
        const validate = vi.fn(() => 'actual full validator refused');
        prepared.transaction.validateDocument('root', validate);
        expect(() => prepared.transaction.commit()).toThrow('actual full validator refused');
        prepared.transaction.abort();
        expect(document).toBe(original);
        expect(reused).toEqual([true]);
        expect(validate).toHaveBeenCalledOnce();
        expect(ordinaryCalls).toBe(0);
    });
});
