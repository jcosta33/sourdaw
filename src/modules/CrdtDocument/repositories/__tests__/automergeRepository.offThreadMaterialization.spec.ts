import {
    applyChanges,
    change,
    changeAt,
    clone,
    decodeChange,
    free,
    from,
    getActorId,
    getAuthor,
    merge,
    getChanges,
    getHeads,
    getObjectId,
    load,
    loadIncremental,
    save,
    type Doc,
} from '@automerge/automerge';
import * as native from '@automerge/automerge';
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

import {
    type ProspectiveMutationWorkerRequest,
    type ProspectiveMutationWorkerResult,
} from '../../models/ProspectiveMutationWorkerProtocol';
import { TransactionalPersistence } from '../../testing/transactionalPersistence';
import { createStore } from '#/infra/store/createStore';

import { commandSourcePublicationContains } from '../../useCases/commandSourcePublicationContains';
import { registerCrdtStorageRuntime } from '../../useCases/registerCrdtStorageRuntime';
import { automergeRepository as repository } from '../automergeRepository';
import { loadAllFromIdb } from '../crdtPersistence/loadAllFromIdb';
import { saveIncrementalsToIdb } from '../crdtPersistence/saveIncrementalsToIdb';
import { readChangesSinceHeads } from '../readChangesSinceHeads';

const mocks = vi.hoisted(() => ({
    request:
        vi.fn<
            (request: ProspectiveMutationWorkerRequest, signal: AbortSignal) => Promise<ProspectiveMutationWorkerResult>
        >(),
    database: vi.fn(),
}));
vi.mock('../prospectiveMutationWorkerClient', () => ({ requestProspectiveMutation: mocks.request }));
vi.mock('../crdtPersistence/helpers', () => ({ STORE_NAME: 'documents', openDatabase: mocks.database }));
vi.mock('@automerge/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@automerge/automerge')>();
    return {
        ...actual,
        clone: vi.fn(actual.clone),
        free: vi.fn(actual.free),
        load: vi.fn(actual.load),
        decodeChange: vi.fn(actual.decodeChange),
        getChanges: vi.fn(actual.getChanges),
        applyChanges: vi.fn(actual.applyChanges),
    };
});

type Document = {
    slot: { count: number; rows?: { id: string; value: number }[] };
    other?: boolean;
    _storagePublicationEvidence?: unknown[];
};
const actor = 'aaaaaaaaaaaaaaaa';
function response(request: ProspectiveMutationWorkerRequest): ProspectiveMutationWorkerResult {
    const seed = load<Record<string, unknown>>(request.seed, { actor: request.actor });
    const candidate = change(seed, { message: request.message }, (doc) =>
        applyCanonicalStorageSlotMutation(doc, request.mutation)
    );
    try {
        return {
            bytes: Uint8Array.from(save(candidate)),
            heads: getHeads(candidate),
        };
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
        value: { ...original.slot, count: unchanged ? 0 : 1 },
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
    it('persists an unsaved prior edit and accepted document from the older IDB baseline with retained row identities', async () => {
        const original = from<Document>(
            {
                slot: {
                    count: 0,
                    rows: [
                        { id: 'locked', value: 1.25 },
                        { id: 'user', value: 0.9 },
                    ],
                },
                _storagePublicationEvidence: [{ version: 1, kind: 'source', memberId: 'member', digest: 'digest' }],
            },
            { actor }
        );
        repository.insertDoc('root', original);
        const oldHeads = getHeads(original);
        const persistence = new TransactionalPersistence();
        persistence.seed('root', Uint8Array.from(save(clone(original))));
        mocks.database.mockResolvedValue(persistence.database);
        repository.saveDocIncremental('root');
        repository.changeDoc<Document>('root', (doc) => {
            doc.other = true;
        });
        const prior = repository.getDoc<Document>('root');
        if (!prior) throw new Error('Expected unsaved prior edit');
        const prepared = plan(prior);
        await prepared.requestMaterialization!(new AbortController().signal);
        expect(repository.getDoc('root')).toBe(prior);
        publish(prepared.materialize());
        const actual = repository.getDoc<Document>('root');
        if (!actual) throw new Error('Expected adoption');
        expect(actual.other).toBe(true);
        expect(actual.slot.count).toBe(1);
        expect(getObjectId(actual.slot.rows)).toBe(getObjectId(original.slot.rows));
        expect(actual.slot.rows?.map((row) => getObjectId(row))).toEqual(
            original.slot.rows?.map((row) => getObjectId(row))
        );
        const [delta] = getChanges(prior, actual);
        if (!delta) throw new Error('Expected one canonical delta');
        expect(decodeChange(delta)).toMatchObject({ actor, seq: 3, deps: getHeads(prior), message: 'Detect' });
        const peer = change(clone(prior, { actor: 'bbbbbbbbbbbbbbbb' }), (doc) => {
            doc.slot.rows![0]!.value = 9.5;
        });
        const [merged] = applyChanges(peer, [delta]);
        expect(merged.slot.rows![0]!.value).toBe(9.5);
        expect(merge(clone(actual), clone(peer))).toEqual(merge(clone(peer), clone(actual)));
        expect(merged.slot.rows![1]).toEqual(actual.slot.rows![1]);
        expect(commandSourcePublicationContains(oldHeads[0]!, 'member', 'source', 'digest')).toBe(true);
        expect(commandSourcePublicationContains(getHeads(actual)[0]!, 'member', 'source', 'digest')).toBe(false);
        const graph = readChangesSinceHeads('root', oldHeads);
        expect(graph).toHaveLength(2);
        const chunk = repository.saveDocIncremental('root');
        if (!chunk) throw new Error('Expected both unsaved changes');
        const saving = saveIncrementalsToIdb([{ id: 'root', chunk }]);
        (await persistence.waitForTransaction('readwrite', 1)).complete();
        expect(await saving).toMatchObject({ status: 'committed' });
        const reading = loadAllFromIdb();
        (await persistence.waitForTransaction('readonly', 1)).complete();
        const bundle = await reading;
        if (!bundle) throw new Error('Expected saved bundle');
        await repository.loadAll({ bundle });
        const reloaded = repository.getDoc<Document>('root');
        expect(reloaded).toEqual(actual);
        expect(readChangesSinceHeads('root', oldHeads)).toEqual(graph);
        repository.insertDoc('root', actual);
        repository.changeDoc<Document>('root', (doc) => {
            doc.slot.count = 2;
        });
        const next = repository.getDoc<Document>('root');
        if (!next) throw new Error('Expected next same-actor change');
        expect(decodeChange(getChanges(actual, next)[0]!)).toMatchObject({ actor, seq: 4, deps: getHeads(actual) });
    });

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
        const [last] = getChanges(actual, next);
        if (!last) throw new Error('Expected native actor continuation');
        expect(decodeChange(last)).toMatchObject({ actor, seq: 3, deps: getHeads(actual) });
    });

    it('materializes through one checked load and native metadata without full decode or incremental apply', async () => {
        const original = seed();
        expect(getAuthor(original)).toBeUndefined();
        const prepared = plan(original);
        await prepared.requestMaterialization!(new AbortController().signal);
        vi.mocked(native.load).mockClear();
        vi.mocked(native.decodeChange).mockClear();
        vi.mocked(native.getChanges).mockClear();
        vi.mocked(native.applyChanges).mockClear();
        const candidate = prepared.materialize();
        expect(native.load).toHaveBeenCalledTimes(1);
        expect(native.load).toHaveBeenCalledWith(expect.any(Uint8Array), { actor });
        expect(native.decodeChange).not.toHaveBeenCalled();
        expect(native.getChanges).not.toHaveBeenCalled();
        expect(native.applyChanges).not.toHaveBeenCalled();
        expect(repository.getDoc('root')).toBe(original);
        publish(candidate);
        expect(repository.getDoc<Document>('root')?.slot.count).toBe(1);
    });

    it.each(['aabbcc', ''])('keeps the complete ordinary callback for native author %s', (author) => {
        const original = from<Document>({ slot: { count: 0 } }, { actor, author });
        repository.insertDoc('root', original);
        const callback = vi.fn((doc: Document) => {
            doc.slot.count = 1;
            doc.other = true;
        });
        const prepared = repository.cloneProspectiveMutation<Document>(
            'root',
            callback,
            'Detect',
            undefined,
            ['slot'],
            {
                kind: 'canonical-json-slot-v1',
                key: 'slot',
                baseValue: original.slot,
                value: { count: 1 },
                documentPresence: { slot: original.slot },
            }
        );
        expect(getAuthor(original)).toBe(author);
        expect(prepared.requestMaterialization).toBeUndefined();
        publish(prepared.materialize());
        expect(callback).toHaveBeenCalledTimes(1);
        expect(mocks.request).not.toHaveBeenCalled();
        const actual = repository.getDoc<Document>('root');
        expect(actual?.other).toBe(true);
        const baseline = change(clone(original, { actor }), { message: 'Detect' }, (doc) => {
            doc.slot.count = 1;
            doc.other = true;
        });
        expect(actual).toEqual(baseline);
        expect(getAuthor(actual!)).toBe(getAuthor(baseline));
    });

    it.each([
        'magic',
        'type',
        'truncated',
        'trailing',
        'overlong',
        'overflow',
        'unterminated',
        'huge',
        'checksum',
        'frontier',
    ] as const)('rejects malformed %s without publication and keeps the actual live handle usable', async (kind) => {
        const original = seed();
        const observer = vi.fn();
        repository.onChange(observer);
        mocks.request.mockImplementationOnce(async (request) => {
            const result = response(request);
            let bytes = Uint8Array.from(result.bytes);
            if (kind === 'magic') bytes[0] = 0;
            if (kind === 'type') bytes[8] = 1;
            if (kind === 'truncated') bytes = bytes.slice(0, 9);
            if (kind === 'trailing') bytes = Uint8Array.from([...bytes, 0]);
            if (kind === 'checksum') bytes[4] = bytes[4]! ^ 1;
            let body = 9;
            while (result.bytes[body]! & 128) body++;
            body++;
            if (kind === 'overlong') {
                bytes[body - 1] = bytes[body - 1]! | 128;
                bytes = Uint8Array.from([...bytes.slice(0, body), 0, ...bytes.slice(body)]);
            }
            if (kind === 'overflow' || kind === 'huge')
                bytes = Uint8Array.from([
                    ...bytes.slice(0, 9),
                    ...Array<number>(9).fill(255),
                    kind === 'overflow' ? 2 : 1,
                    ...bytes.slice(body),
                ]);
            if (kind === 'unterminated')
                bytes = Uint8Array.from([...bytes.slice(0, 9), ...Array<number>(10).fill(128)]);
            if (kind === 'frontier') {
                const unrelated = from<Document>({ slot: { count: 1 } }, { actor });
                try {
                    return { bytes: Uint8Array.from(save(unrelated)), heads: getHeads(unrelated) };
                } finally {
                    free(unrelated);
                }
            }
            return { ...result, bytes };
        });
        const prepared = plan(original);
        await prepared.requestMaterialization!(new AbortController().signal);
        vi.mocked(native.load).mockClear();
        expect(prepared.materialize).toThrow(kind === 'frontier' ? 'lost the native frontier' : undefined);
        if (kind !== 'checksum' && kind !== 'frontier') expect(native.load).not.toHaveBeenCalled();
        prepared.discard();
        expect(repository.getDoc('root')).toBe(original);
        expect(observer).not.toHaveBeenCalled();
        repository.changeDoc<Document>('root', (doc) => {
            doc.slot.count = 7;
        });
        expect(repository.getDoc<Document>('root')?.slot.count).toBe(7);
    });

    it.each([
        {
            bytes: 'hW9Kg7/g/vAAqAEBCKqqqqqqqqqqAcev77hfq7G+L0sekua4qgIZg7HfYDbJdk49cBqKsMG9CAECAwITAiMLNRlAA0MCVgIKFQchAiMCNAFCAlYEVwmAAQOBAQKDAQICAAIBAgF+8pOP1waO7PCoeQABfxVmaXh0dXJlIHNlY29uZCBjaGFuZ2V+AAF/PwIHAgVjb3VudAIAAgECAgF+hQEUAAAAAAAAAAABfgEAfwB/AgE=',
            error: 'index out of bounds: the len is 2 but the index is 63',
        },
        {
            bytes: 'hW9KgwieC+gAqAEBCKqqqqqqqqqqAcev77hfq7G+L0sekua4qgIZg7HfYDbJdk49cBqKsMG9CAECAwITAiMLNRlAA0MCVgIKFQchAiMCNAFCAlYEVwmAAQOBAQKDAQICAAICAgF+8pOP1waO7PCoeQABfxVmaXh0dXJlIHNlY29uZCBjaGFuZ2V+AAF/AAIHAgVjb3VudAIAAgECAgF+hQEUAAAAAAAAAAABfgEAfwB/AgE=',
            error: 'invalid changes: changes out of order',
        },
    ])('rejects a checksum-correct malformed native document: $error', async ({ bytes, error }) => {
        const original = seed();
        const observer = vi.fn();
        repository.onChange(observer);
        const releases = vi.mocked(native.free).mockClear();
        mocks.request.mockResolvedValueOnce({
            bytes: Uint8Array.from(atob(bytes), (char) => char.charCodeAt(0)),
            heads: getHeads(original),
        });
        const prepared = plan(original);
        await prepared.requestMaterialization!(new AbortController().signal);
        const retained = vi.mocked(native.clone).mock.results.at(-2)!.value;
        expect(prepared.materialize).toThrow(error);
        prepared.discard();
        prepared.discard();
        expect(releases.mock.calls.filter(([doc]) => doc === retained)).toHaveLength(1);
        expect(repository.getDoc('root')).toBe(original);
        expect(observer).not.toHaveBeenCalled();
        repository.changeDoc<Document>('root', (doc) => {
            doc.slot.count = 7;
        });
        const actual = repository.getDoc<Document>('root');
        expect(actual?.slot.count).toBe(7);
        const reloaded = load<Document>(save(clone(actual!, { actor })), { actor });
        expect(reloaded).toEqual(actual);
        free(reloaded);
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
        'sequence',
        'dependencies',
        'message',
        'heads',
        'missing change',
        'transport',
    ] as const)('refuses %s without fallback/publication', async (kind) => {
        const original = seed();
        const observer = vi.fn();
        repository.onChange(observer);
        const prepared = plan(original);
        if (kind === 'invalid bytes')
            mocks.request.mockResolvedValueOnce({ bytes: Uint8Array.of(1), heads: getHeads(original) });
        if (kind === 'transport') mocks.request.mockRejectedValueOnce(new Error('transport failed'));
        if (['sequence', 'dependencies', 'message', 'heads', 'missing change'].includes(kind))
            mocks.request.mockImplementationOnce(async (request) => {
                const result = response(request);
                if (kind === 'heads') return { ...result, heads: request.heads };
                if (kind === 'missing change') return { bytes: Uint8Array.from(request.seed), heads: result.heads };
                const base = load<Record<string, unknown>>(request.seed, { actor: request.actor });
                let candidate = base;
                try {
                    if (kind === 'sequence') {
                        // A valid history with another native commit must still fail the one-change contract.
                        candidate = change(candidate, (doc) => {
                            doc.other = true;
                        });
                    }
                    candidate =
                        kind === 'dependencies'
                            ? changeAt(candidate, [], { message: request.message }, (doc) =>
                                  applyCanonicalStorageSlotMutation(doc, request.mutation)
                              ).newDoc
                            : change(
                                  candidate,
                                  { message: kind === 'message' ? 'Other mutation' : request.message },
                                  (doc) => applyCanonicalStorageSlotMutation(doc, request.mutation)
                              );
                    return { bytes: Uint8Array.from(save(candidate)), heads: getHeads(candidate) };
                } finally {
                    free(candidate);
                }
            });
        if (kind === 'wrong actor' || kind === 'extra change')
            mocks.request.mockImplementationOnce(async (request) => {
                const seed = load<Document>(request.seed, {
                    actor: kind === 'wrong actor' ? 'bbbbbbbbbbbbbbbb' : request.actor,
                });
                let candidate = change(seed, { message: request.message }, (draft) =>
                    applyCanonicalStorageSlotMutation(draft, request.mutation)
                );
                if (kind === 'extra change')
                    candidate = change(candidate, (draft) => {
                        draft.other = true;
                    });
                try {
                    return {
                        bytes: Uint8Array.from(save(candidate)),
                        heads: getHeads(candidate),
                    };
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
            } else
                expect(prepared.materialize).toThrow(
                    ['wrong actor', 'dependencies', 'message'].includes(kind) ? 'changed native authority' : undefined
                );
            prepared.discard();
        }
        expect(repository.getDoc<Document>('root')?.slot.count).toBe(0);
        expect(observer).not.toHaveBeenCalled();
        expect(mocks.request).toHaveBeenCalledTimes(1);
    });

    it.each(['discard', 'abort', 'transport', 'stale', 'validator'] as const)(
        'frees both private clones exactly once after %s and leaves the live handle writable',
        async (kind) => {
            const original = seed();
            const clones = vi.mocked(native.clone).mockClear();
            const releases = vi.mocked(native.free).mockClear();
            if (kind === 'transport' || kind === 'abort')
                mocks.request.mockImplementationOnce(async (_request, signal) => {
                    if (kind === 'abort')
                        await new Promise<void>((resolve) =>
                            signal.addEventListener('abort', () => resolve(), { once: true })
                        );
                    throw new Error(kind);
                });
            const prepared = plan(original);
            const controller = new AbortController();
            const request = prepared.requestMaterialization!(controller.signal);
            if (kind === 'transport' || kind === 'abort') {
                const rejected = expect(request).rejects.toThrow(kind);
                controller.abort();
                await rejected;
            } else {
                await request;
                if (kind === 'stale') {
                    repository.insertDoc('root', clone(original));
                    repository.insertDoc('root', original);
                    expect(prepared.materialize).toThrow();
                }
                if (kind === 'validator') {
                    const candidate = prepared.materialize();
                    expect(() =>
                        publish(candidate, () => {
                            throw new Error('refused');
                        })
                    ).toThrow('refused');
                    candidate.discard();
                }
            }
            prepared.discard();
            prepared.discard();
            const retained = clones.mock.results[0]!.value;
            const encoding = clones.mock.results[1]!.value;
            expect(releases.mock.calls.filter(([doc]) => doc === encoding)).toHaveLength(1);
            expect(releases.mock.calls.filter(([doc]) => doc === retained)).toHaveLength(1);
            expect(releases.mock.calls.some(([doc]) => doc === original)).toBe(false);
            expect(releases).toHaveBeenCalledTimes(
                kind === 'transport' || kind === 'abort' ? 2 : kind === 'validator' ? 4 : 3
            );
            repository.changeDoc<Document>('root', (doc) => {
                doc.slot.count = 7;
            });
            expect(repository.getDoc<Document>('root')?.slot.count).toBe(7);
        }
    );

    it('retains the actual storage callback fallback when publication metadata appears after Worker adoption', async () => {
        seed();
        registerCrdtStorageRuntime();
        const storage = createAutomergeStorage<{ count: number }>('root', 'slot');
        storage.hydrate?.();
        const store = createStore({ storage, initialData: { count: 0 } });
        const checkpoint = createAutomergeStorage<{ records: string[] }>('root', 'checkpoint');
        checkpoint.hydrate?.();
        const release = store.subscribe(() => {
            checkpoint.set({ records: ['subscriber checkpoint'] });
            appendAutomergeStoragePublicationMetadata('root', {
                version: 1,
                kind: 'new-source',
                memberId: 'new-member',
                digest: 'new-digest',
            });
        });
        const transaction = runWithAutomergeStorageTransaction(undefined, captureAutomergeStoragePreparationScope);
        if (transaction.status !== 'returned') throw transaction.error;
        const preparation = storage.prepareSet?.(transaction.value, { count: 1 }, (value) => store.set(value));
        if (!preparation) throw new Error('Expected preparation');
        preparation.clone();
        const request = preparation.requestMaterialization;
        if (!request) throw new Error('Expected request');
        await request(new AbortController().signal);
        preparation.materialize();
        expect(mocks.request).toHaveBeenCalledTimes(1);
        expect(transaction.scope(preparation.stage)).toBe(true);
        transaction.validateDocument('root', () => null);
        transaction.commit();
        release();
        const current = repository.getDoc<Document>('root');
        if (!current) throw new Error('Expected complete fallback publication');
        expect(current.slot.count).toBe(1);
        expect(Reflect.get(current, 'checkpoint')).toEqual({ records: ['subscriber checkpoint'] });
        expect(commandSourcePublicationContains(getHeads(current)[0]!, 'new-member', 'new-source', 'new-digest')).toBe(
            true
        );
    });
});
