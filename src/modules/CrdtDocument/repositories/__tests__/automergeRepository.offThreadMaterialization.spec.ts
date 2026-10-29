import {
    applyChanges,
    change,
    clone,
    decodeChange,
    free,
    from,
    getActorId,
    getChanges,
    getHeads,
    getLastLocalChange,
    load,
    loadIncremental,
    save,
    type Doc,
} from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    applyCanonicalStorageSlotMutation,
    type CanonicalStorageSlotMutation,
} from '#/infra/store/storage/applyCanonicalStorageSlotMutation';
import {
    configureAutomergeStoragePort,
    appendAutomergeStoragePublicationMetadata,
    captureAutomergeStoragePreparationScope,
    createAutomergeStorage,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { type ProspectiveMutationWorkerRequest } from '../../models/ProspectiveMutationWorkerProtocol';
import { TransactionalPersistence } from '../../testing/transactionalPersistence';
import { commandSourcePublicationContains } from '../../useCases/commandSourcePublicationContains';
import { registerCrdtStorageRuntime } from '../../useCases/registerCrdtStorageRuntime';
import { automergeRepository as repository } from '../automergeRepository';
import { loadAllFromIdb } from '../crdtPersistence/loadAllFromIdb';
import { saveIncrementalsToIdb } from '../crdtPersistence/saveIncrementalsToIdb';
import { readChangesSinceHeads } from '../readChangesSinceHeads';

const mocks = vi.hoisted(() => ({
    request:
        vi.fn<(request: ProspectiveMutationWorkerRequest, signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>>(),
    database: vi.fn(),
}));
vi.mock('../prospectiveMutationWorkerClient', () => ({ requestProspectiveMutation: mocks.request }));
vi.mock('../crdtPersistence/helpers', () => ({ STORE_NAME: 'documents', openDatabase: mocks.database }));

type Document = { slot: { count: number }; other?: boolean; _storagePublicationEvidence?: unknown[] };
const actor = 'aaaaaaaaaaaaaaaa';
function response(request: ProspectiveMutationWorkerRequest): Uint8Array<ArrayBuffer> {
    const candidate = change(
        load<Record<string, unknown>>(request.seed, { actor: request.actor }),
        { message: request.message },
        (doc) => applyCanonicalStorageSlotMutation(doc, request.mutation)
    );
    try {
        return Uint8Array.from(save(candidate));
    } finally {
        free(candidate);
    }
}
function seed() {
    const doc = from<Document>(
        {
            slot: { count: 0 },
            _storagePublicationEvidence: [{ version: 1, kind: 'source', memberId: 'member', digest: 'digest' }],
        },
        { actor }
    );
    repository.insertDoc('root', doc);
    return doc;
}
function plan(original: Doc<Document>, unchanged = false) {
    const mutation: CanonicalStorageSlotMutation = {
        kind: 'canonical-json-slot-v1',
        key: 'slot',
        baseValue: original.slot,
        value: { count: unchanged ? 0 : 1 },
        documentPresence: { slot: original.slot },
    };
    const candidate = repository.cloneProspectiveMutation<Document>(
        'root',
        (doc) => applyCanonicalStorageSlotMutation(doc, mutation),
        'Detect',
        undefined,
        ['slot'],
        mutation
    );
    if (!candidate.requestMaterialization) throw new Error('Expected canonical Worker request');
    return candidate;
}
function publish(candidate: ReturnType<ReturnType<typeof plan>['materialize']>, validateDocument = vi.fn()) {
    const onPublished = vi.fn();
    repository.changeDoc<Document>(
        'root',
        () => {
            throw new Error('Prepared callback must not run twice');
        },
        'Detect',
        undefined,
        ['slot'],
        { preparedCandidate: candidate, validateDocument, beforePublication: vi.fn(), onPublished }
    );
    expect(onPublished).toHaveBeenCalledOnce();
}
beforeEach(() => {
    repository.reset();
    mocks.request.mockReset();
    mocks.request.mockImplementation(async (request) => response(request));
});
afterEach(() => {
    configureAutomergeStoragePort(null);
    repository.reset();
    vi.restoreAllMocks();
});

describe('repository canonical Worker candidate adoption', () => {
    it('preserves native graph/source readers, real incremental persistence/reload and the next actual actor sequence', async () => {
        const original = seed();
        const oldHeads = getHeads(original);
        const baseBytes = Uint8Array.from(save(clone(original)));
        const persistence = new TransactionalPersistence();
        persistence.seed('root', baseBytes);
        mocks.database.mockResolvedValue(persistence.database);
        repository.saveDocIncremental('root');
        expect(commandSourcePublicationContains(oldHeads[0]!, 'member', 'source', 'digest')).toBe(true);
        const observer = vi.fn();
        const release = repository.onChange(observer);
        const prepared = plan(original);
        await prepared.requestMaterialization!(new AbortController().signal);
        expect(repository.getDoc('root')).toBe(original);
        expect(observer).not.toHaveBeenCalled();
        const cursorChunk = repository.saveDocIncremental('root');
        expect(cursorChunk).toBeDefined();
        expect(loadIncremental(load<Document>(baseBytes), cursorChunk!).slot.count).toBe(0);
        const candidate = prepared.materialize();
        expect(repository.getDoc('root')).toBe(original);
        publish(candidate);
        const actual = repository.getDoc<Document>('root');
        if (!actual) throw new Error('Expected publication');
        expect(observer).toHaveBeenCalledExactlyOnceWith('root', { localSlots: ['slot'] });
        const changes = getChanges(original, actual);
        expect(changes).toHaveLength(1);
        const decoded = decodeChange(changes[0]!);
        expect(decoded).toMatchObject({ actor, seq: 2, deps: oldHeads, message: 'Detect' });
        expect(readChangesSinceHeads('root', oldHeads)).toEqual([{ hash: decoded.hash, deps: oldHeads }]);
        expect(commandSourcePublicationContains(oldHeads[0]!, 'member', 'source', 'digest')).toBe(true);
        expect(commandSourcePublicationContains(decoded.hash, 'member', 'source', 'digest')).toBe(false);
        const [peer] = applyChanges(clone(original, { actor: 'bbbbbbbbbbbbbbbb' }), changes);
        expect(peer).toEqual(actual);
        const chunk = repository.saveDocIncremental('root');
        if (!chunk) throw new Error('Expected actual persistence chunk');
        const persisted = saveIncrementalsToIdb([{ id: 'root', chunk }]);
        (await persistence.waitForTransaction('readwrite', 1)).complete();
        expect(await persisted).toMatchObject({ status: 'committed' });
        const reading = loadAllFromIdb();
        (await persistence.waitForTransaction('readonly', 1)).complete();
        const bundle = await reading;
        if (!bundle) throw new Error('Expected saved bundle');
        release();
        await repository.loadAll({ bundle });
        expect(repository.getDoc<Document>('root')?.slot.count).toBe(1);
        expect(readChangesSinceHeads('root', oldHeads)).toEqual([{ hash: decoded.hash, deps: oldHeads }]);
        // Reload changes the local actor by the repository's existing load contract; adoption itself does not.
        repository.insertDoc('root', actual);
        repository.changeDoc<Document>('root', (doc) => {
            doc.slot.count = 2;
        });
        const next = repository.getDoc<Document>('root');
        if (!next) throw new Error('Expected next change');
        expect(getActorId(next)).toBe(actor);
        const last = getLastLocalChange(next);
        if (!last) throw new Error('Expected native actor continuation');
        expect(decodeChange(last)).toMatchObject({ actor, seq: 3, deps: getHeads(actual) });
    });

    it('leaves the original live handle writable and its unsaved cursor intact after discarded preparation', async () => {
        const original = seed();
        const baseline = Uint8Array.from(save(clone(original)));
        repository.saveDocIncremental('root');
        repository.changeDoc<Document>('root', (doc) => {
            doc.other = true;
        });
        const current = repository.getDoc<Document>('root');
        if (!current) throw new Error('Expected live edit');
        const prepared = plan(current);
        await prepared.requestMaterialization!(new AbortController().signal);
        prepared.discard();
        const chunk = repository.saveDocIncremental('root');
        if (!chunk) throw new Error('Expected unsaved live change');
        expect(loadIncremental(load<Document>(baseline), chunk).other).toBe(true);
        repository.changeDoc<Document>('root', (doc) => {
            doc.slot.count = 7;
        });
        expect(repository.getDoc<Document>('root')?.slot.count).toBe(7);
    });

    it('adopts a genuine no-op without inventing or rejecting a native change', async () => {
        const original = seed();
        const prepared = plan(original, true);
        await prepared.requestMaterialization!(new AbortController().signal);
        publish(prepared.materialize());
        const current = repository.getDoc<Document>('root');
        if (!current) throw new Error('Expected validated no-op');
        expect(getChanges(original, current)).toEqual([]);
        expect(current).toEqual(original);
    });

    it.each([
        'mutation',
        'root ABA',
        'validator',
        'invalid bytes',
        'wrong actor',
        'extra change',
        'transport',
    ] as const)('refuses %s without fallback/publication', async (kind) => {
        const original = seed();
        const observer = vi.fn();
        repository.onChange(observer);
        const prepared = plan(original);
        if (kind === 'invalid bytes') mocks.request.mockResolvedValueOnce(Uint8Array.of(1));
        if (kind === 'transport') mocks.request.mockRejectedValueOnce(new Error('transport failed'));
        if (kind === 'wrong actor' || kind === 'extra change')
            mocks.request.mockImplementationOnce(async (request) => {
                let candidate = load<Document>(request.seed, {
                    actor: kind === 'wrong actor' ? 'bbbbbbbbbbbbbbbb' : request.actor,
                });
                candidate = change(candidate, { message: request.message }, (draft) =>
                    applyCanonicalStorageSlotMutation(draft, request.mutation)
                );
                if (kind === 'extra change')
                    candidate = change(candidate, (draft) => {
                        draft.other = true;
                    });
                try {
                    return Uint8Array.from(save(candidate));
                } finally {
                    free(candidate);
                }
            });
        if (kind === 'transport') {
            await expect(prepared.requestMaterialization!(new AbortController().signal)).rejects.toThrow(
                'transport failed'
            );
            prepared.discard();
        } else {
            await prepared.requestMaterialization!(new AbortController().signal);
            if (kind === 'mutation')
                repository.changeDoc<Document>('root', (doc) => {
                    doc.other = true;
                });
            if (kind === 'root ABA') {
                repository.insertDoc('root', clone(original));
                repository.insertDoc('root', original);
            }
            observer.mockClear();
            if (kind === 'validator') {
                const candidate = prepared.materialize();
                expect(() =>
                    publish(candidate, () => {
                        throw new Error('full validator refused');
                    })
                ).toThrow('full validator refused');
                candidate.discard();
            } else expect(prepared.materialize).toThrow();
            prepared.discard();
        }
        expect(repository.getDoc<Document>('root')?.slot.count).toBe(0);
        expect(observer).not.toHaveBeenCalled();
        expect(mocks.request).toHaveBeenCalledTimes(1);
    });

    it('retains the actual storage callback fallback when publication metadata appears after Worker adoption', async () => {
        seed();
        registerCrdtStorageRuntime();
        const storage = createAutomergeStorage<{ count: number }>('root', 'slot');
        storage.hydrate?.();
        const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
        if (transaction.status !== 'returned') throw transaction.error;
        const preparation = storage.prepareSet?.(transaction.value, { count: 1 });
        if (!preparation) throw new Error('Expected preparation');
        preparation.clone();
        const request = preparation.requestMaterialization;
        if (!request) throw new Error('Expected request');
        await request(new AbortController().signal);
        preparation.materialize();
        expect(transaction.scope(preparation.stage)).toBe(true);
        transaction.scope(() =>
            appendAutomergeStoragePublicationMetadata('root', {
                version: 1,
                kind: 'new-source',
                memberId: 'new-member',
                digest: 'new-digest',
            })
        );
        transaction.validateDocument('root', () => null);
        transaction.commit();
        const current = repository.getDoc<Document>('root');
        if (!current) throw new Error('Expected complete fallback publication');
        expect(current.slot.count).toBe(1);
        expect(commandSourcePublicationContains(getHeads(current)[0]!, 'new-member', 'new-source', 'new-digest')).toBe(
            true
        );
    });
});
