import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import {
    change,
    clone,
    decodeChange,
    from,
    getActorId,
    getChangesMetaSince,
    getHeads,
    getLastLocalChange,
    merge,
    saveIncremental,
    toJS,
    type Doc,
} from '@automerge/automerge';
import { initializeWasm } from '@automerge/automerge/slim';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NativePreparationWorker, settleNativePreparationWorkers } from '#/helpers/__tests__/nativePreparationWorker';
import { logger } from '#/infra/logger/appLogger';
import {
    getCurrentAutomergeStorageMutationOwner,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { type ProspectiveMutationWorkerRequest } from '../../models/ProspectiveMutationWorkerProtocol';
import { automergeRepository as repository } from '../automergeRepository';
import * as workerClient from '../prospectiveMutationWorkerClient';

type State = { count: number; peer?: boolean; replacement?: boolean };
const ACTOR = 'aaaaaaaaaaaaaaaa';
const PEER = 'bbbbbbbbbbbbbbbb';

function seed(): Doc<State> {
    const document = from<State>({ count: 0 }, { actor: ACTOR });
    repository.insertDoc('root', document);
    return document;
}

function epochs() {
    return {
        identity: repository.getDocumentIdentityEpoch(),
        root: repository.getRootIdentityEpoch(),
        mutation: repository.getMutationEpoch(),
        unowned: repository.getUnownedMutationEpoch(),
    };
}

function validation(validateDocument: (document: Doc<State>) => void = () => undefined) {
    return { validateDocument: vi.fn(validateDocument), beforePublication: vi.fn(), onPublished: vi.fn() };
}

async function receiveNativePreparation(request: ProspectiveMutationWorkerRequest): Promise<MessageEvent<unknown>> {
    const worker = new NativePreparationWorker(new URL('../../workers/prospectiveMutationWorker.ts', import.meta.url));
    try {
        const reply = Promise.withResolvers<MessageEvent<unknown>>();
        worker.onmessage = reply.resolve;
        worker.onerror = () => reply.reject(new Error('Native preparation Worker failed'));
        worker.onmessageerror = () => reply.reject(new Error('Native preparation Worker message failed'));
        worker.postMessage(request, [request.seed.buffer]);
        const event = await reply.promise;
        expect(event.data).toMatchObject({ status: 'complete' });
        return event;
    } finally {
        worker.terminate();
    }
}

beforeEach(() => repository.reset());
beforeAll(async () => {
    const require = createRequire(import.meta.url);
    await initializeWasm(Uint8Array.from(readFileSync(require.resolve('@automerge/automerge/automerge.wasm'))));
});
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    repository.reset();
    await settleNativePreparationWorkers();
});

describe('private prospective Automerge candidates', () => {
    it('bounds an explicitly requested native sequence before transferring its private candidate', async () => {
        type SequenceState = { slot: { text: string } };
        const original = from<SequenceState>({ slot: { text: '' } }, { actor: ACTOR });
        repository.insertDoc('root', original);
        const target = { text: 'native sequence '.repeat(300) };
        const mutation = {
            kind: 'canonical-json-slot-v1' as const,
            key: 'slot',
            baseValue: { text: '' },
            value: target,
            documentPresence: { slot: { text: '' } },
        };
        vi.stubGlobal('Worker', NativePreparationWorker);
        const request = vi.spyOn(workerClient, 'requestProspectiveMutation');
        const changeFn = vi.fn((draft: SequenceState) => {
            draft.slot = target;
        });
        const preparation = repository.cloneProspectiveMutation<SequenceState>(
            'root',
            changeFn,
            'Capture arrangement',
            undefined,
            ['slot'],
            mutation,
            'bounded-native-sequence-v1'
        );
        const observer = vi.fn();
        repository.onChange(observer);
        await expect(preparation.requestMaterialization?.(new AbortController().signal)).resolves.toBeUndefined();
        expect(request).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ preparationPolicy: 'bounded-native-sequence-v1' }),
            expect.any(AbortSignal)
        );
        expect(repository.getDoc('root')).toBe(original);
        expect(observer).not.toHaveBeenCalled();
        const prepared = preparation.materialize();
        expect(changeFn).not.toHaveBeenCalled();
        repository.changeDoc<SequenceState>('root', changeFn, 'Capture arrangement', undefined, ['slot'], {
            preparedCandidate: prepared,
            validateDocument: (document) => expect(document.slot).toEqual(target),
            beforePublication: () => undefined,
            onPublished: () => undefined,
        });
        expect(repository.getDoc<SequenceState>('root')?.slot).toEqual(target);
        expect(observer).toHaveBeenCalledOnce();
        expect(getChangesMetaSince(repository.getDoc('root')!, getHeads(original)).length).toBeGreaterThan(1);
        expect(changeFn).not.toHaveBeenCalled();
    });

    it('admits after an await under the exact captured open storage owner', async () => {
        const original = from({ slot: { text: '' } }, { actor: ACTOR });
        repository.insertDoc('root', original);
        const mutation = {
            kind: 'canonical-json-slot-v1' as const,
            key: 'slot',
            baseValue: { text: '' },
            value: { text: 'owned sequence '.repeat(180) },
            documentPresence: { slot: { text: '' } },
        };
        vi.stubGlobal('Worker', NativePreparationWorker);
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            repository.cloneProspectiveMutation(
                'root',
                () => {
                    throw new Error('Canonical preparation must not replay the callback');
                },
                undefined,
                undefined,
                ['slot'],
                mutation,
                'bounded-native-sequence-v1'
            )
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const preparation = transaction.value;
        try {
            const request = transaction.scope(() => preparation.requestMaterialization?.(new AbortController().signal));
            await request;
            expect(getCurrentAutomergeStorageMutationOwner()).toBeUndefined();
            expect(repository.getDoc('root')).toBe(original);
            const candidate = transaction.scope(() => preparation.materialize());
            transaction.scope(() =>
                repository.changeDoc('root', () => undefined, undefined, undefined, ['slot'], {
                    preparedCandidate: candidate,
                    validateDocument: (document) => expect(document.slot).toEqual(mutation.value),
                    beforePublication: () => undefined,
                    onPublished: () => undefined,
                })
            );
            transaction.commit();
            expect(repository.getDoc('root')?.slot).toEqual(mutation.value);
        } finally {
            preparation.discard();
            transaction.abort();
        }
    });

    it.each(['foreign-mutation', 'root-replacement', 'discard', 'abort-owner'] as const)(
        'refuses %s after a privately admitted prefix without later native publication',
        async (revocation) => {
            const original = from({ slot: { text: '' } }, { actor: ACTOR });
            repository.insertDoc('root', original);
            const originalHeads = getHeads(original);
            const originalHistory = getChangesMetaSince(original, []);
            const mutation = {
                kind: 'canonical-json-slot-v1' as const,
                key: 'slot',
                baseValue: { text: '' },
                value: { text: 'owned sequence '.repeat(180) },
                documentPresence: { slot: { text: '' } },
            };
            vi.stubGlobal('Worker', NativePreparationWorker);
            const Channel = globalThis.MessageChannel;
            const held = Promise.withResolvers<() => void>();
            let hostTasks = 0;
            vi.stubGlobal(
                'MessageChannel',
                class extends Channel {
                    constructor() {
                        super();
                        if (++hostTasks === 2) {
                            const post = this.port2.postMessage.bind(this.port2);
                            this.port2.postMessage = () => held.resolve(() => post(undefined));
                        }
                    }
                }
            );
            const observer = vi.fn();
            repository.onChange(observer);
            const transaction = runWithAutomergeStorageTransaction(undefined, () =>
                repository.cloneProspectiveMutation(
                    'root',
                    () => undefined,
                    undefined,
                    undefined,
                    ['slot'],
                    mutation,
                    'bounded-native-sequence-v1'
                )
            );
            if (transaction.status !== 'returned') {
                throw transaction.error;
            }
            const preparation = transaction.value;
            try {
                const request = preparation.requestMaterialization;
                if (!request) {
                    throw new Error('Expected the explicit native request route');
                }
                const requested = transaction.scope(() => request(new AbortController().signal));
                const release = await Promise.race([
                    held.promise,
                    requested.then(() => {
                        throw new Error('Bounded admission finished before the private prefix was held');
                    }),
                ]);
                expect(hostTasks).toBe(2);
                expect(repository.getDoc('root')).toBe(original);
                expect(observer).not.toHaveBeenCalled();
                if (revocation === 'foreign-mutation') {
                    repository.changeDoc<Record<string, unknown>>('root', (draft) => {
                        draft.peer = true;
                    });
                }
                if (revocation === 'root-replacement') {
                    repository.insertDoc('root', from({ replacement: true }));
                }
                if (revocation === 'discard') {
                    preparation.discard();
                }
                if (revocation === 'abort-owner') {
                    transaction.abort();
                }
                const live = repository.getDoc('root');
                if (!live) {
                    throw new Error('Revocation control lost its actual root');
                }
                const truth = toJS(live);
                const heads = getHeads(live);
                const publications = observer.mock.calls.length;
                const retainedHistory = getChangesMetaSince(original, []);
                expect(retainedHistory.slice(0, originalHistory.length)).toEqual(originalHistory);
                release();
                await expect(requested).rejects.toThrow();
                expect(repository.getDoc('root')).toBe(live);
                expect(toJS(live)).toEqual(truth);
                expect(getHeads(live)).toEqual(heads);
                expect(observer).toHaveBeenCalledTimes(publications);
                expect(getHeads(original)).toEqual(originalHeads);
                expect(getChangesMetaSince(original, [])).toEqual(retainedHistory);
                expect(getCurrentAutomergeStorageMutationOwner()).toBeUndefined();
            } finally {
                preparation.discard();
                transaction.abort();
                vi.unstubAllGlobals();
            }
        }
    );

    it('requires completed bounded admission before materializing and retires a still pending Worker', async () => {
        type SequenceState = { slot: { text: string } };
        const original = from<SequenceState>({ slot: { text: '' } }, { actor: ACTOR });
        repository.insertDoc('root', original);
        const truth = toJS(original);
        const heads = getHeads(original);
        const history = getChangesMetaSince(original, []);
        const cursorControl = clone(original, { actor: ACTOR });
        const cursor = saveIncremental(cursorControl);
        const native = await import('@automerge/automerge');
        native.free(cursorControl);
        expect(cursor.length).toBeGreaterThan(0);
        const observer = vi.fn();
        repository.onChange(observer);
        const mutation = {
            kind: 'canonical-json-slot-v1' as const,
            key: 'slot',
            baseValue: { text: '' },
            value: { text: 'Prepared' },
            documentPresence: { slot: { text: '' } },
        };
        const changeFn = vi.fn((draft: SequenceState) => {
            draft.slot = mutation.value;
        });
        const create = () =>
            repository.cloneProspectiveMutation<SequenceState>(
                'root',
                changeFn,
                undefined,
                undefined,
                ['slot'],
                mutation,
                'bounded-native-sequence-v1'
            );
        const unrequested = create();
        let unexpected: ReturnType<typeof unrequested.materialize> | undefined;
        try {
            expect(() => {
                unexpected = unrequested.materialize();
            }).toThrow('Prospective mutation Worker has not completed');
            expect(changeFn).not.toHaveBeenCalled();
        } finally {
            unexpected?.discard();
            unrequested.discard();
        }
        const posted = Promise.withResolvers<ProspectiveMutationWorkerRequest>();
        const terminated = vi.fn();
        const holder: { worker?: HeldWorker } = {};
        class HeldWorker {
            onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
            onerror: (() => void) | null = null;
            onmessageerror: (() => void) | null = null;
            constructor() {
                holder.worker = this;
            }
            postMessage(input: ProspectiveMutationWorkerRequest, transfer: Transferable[]): void {
                posted.resolve(structuredClone(input, { transfer }));
            }
            terminate(): void {
                terminated();
            }
        }
        vi.stubGlobal('Worker', HeldWorker);
        vi.useFakeTimers();
        const pending = create();
        try {
            const request = pending.requestMaterialization;
            if (!request) {
                throw new Error('Expected the explicit native request route');
            }
            const requested = request(new AbortController().signal);
            const rejected = expect(requested).rejects.toThrow('Prospective mutation Worker has not completed');
            const input = await posted.promise;
            const held = holder.worker;
            if (!held?.onmessage) {
                throw new Error('Actual private client did not install its pending callback');
            }
            const late = held.onmessage;
            expect(() => pending.materialize()).toThrow('Prospective mutation Worker has not completed');
            await rejected;
            expect(terminated).toHaveBeenCalledOnce();
            expect(held.onmessage).toBeNull();
            expect(held.onerror).toBeNull();
            expect(held.onmessageerror).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
            vi.useRealTimers();
            late(await receiveNativePreparation(input));
            expect(() => pending.materialize()).toThrow('already settled');
            expect(changeFn).not.toHaveBeenCalled();
            expect(observer).not.toHaveBeenCalled();
            expect(repository.getDoc('root')).toBe(original);
            expect(toJS(original)).toEqual(truth);
            expect(getHeads(original)).toEqual(heads);
            expect(getChangesMetaSince(original, [])).toEqual(history);
            expect(saveIncremental(original)).toEqual(cursor);
        } finally {
            pending.discard();
            vi.useRealTimers();
            vi.unstubAllGlobals();
        }
    });

    it('rejects without consuming the original handle, epochs, observers, owner publications or snapshot capture', async () => {
        const original = seed();
        const before = epochs();
        const heads = getHeads(original);
        const observer = vi.fn();
        repository.onChange(observer);
        let owner: object | undefined;
        const snapshots = await repository.transactSnapshot(async (snapshot) => {
            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                owner = getCurrentAutomergeStorageMutationOwner();
                const callbacks = validation((candidate) => {
                    expect(candidate.count).toBe(999);
                    expect(repository.getDoc('root')).toBe(original);
                    throw new Error('candidate refused');
                });
                expect(() =>
                    repository.changeDoc<State>(
                        'root',
                        (doc) => {
                            doc.count = 999;
                        },
                        'refused',
                        snapshot,
                        ['count'],
                        callbacks
                    )
                ).toThrow('candidate refused');
                expect(callbacks.beforePublication).not.toHaveBeenCalled();
                expect(callbacks.onPublished).not.toHaveBeenCalled();
            });
            transaction.commit();
        });
        expect(snapshots.before.size).toBe(0);
        expect(snapshots.after.size).toBe(0);
        expect(repository.getDoc('root')).toBe(original);
        expect(getHeads(original)).toEqual(heads);
        expect(epochs()).toEqual(before);
        expect(observer).not.toHaveBeenCalled();
        if (!owner) {
            throw new Error('Expected exact storage owner');
        }
        expect(repository.readOwnedDocumentPublications(owner)).toEqual([]);
        expect(repository.getMutationEpochForOwner(owner)).toBe(0);
        repository.changeDoc<State>('root', (doc) => {
            doc.count = 1;
        });
        expect(repository.getDoc<State>('root')?.count).toBe(1);
    });

    it('installs the exact validated object with actual actor continuation, dependencies and peer convergence', () => {
        const original = seed();
        expect(getActorId(original)).toBe(ACTOR);
        expect(repository.getActorId()).not.toBe(ACTOR);
        let validated: Doc<State> | undefined;
        let owner: object | undefined;
        const callbacks = validation((candidate) => {
            validated = candidate;
            expect(repository.getDoc('root')).toBe(original);
        });
        const observer = vi.fn();
        repository.onChange(observer);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            owner = getCurrentAutomergeStorageMutationOwner();
            repository.changeDoc<State>(
                'root',
                (doc) => {
                    doc.count = 1;
                },
                'accepted',
                undefined,
                ['count'],
                callbacks
            );
        });
        transaction.commit();
        const accepted = repository.getDoc<State>('root');
        expect(accepted).toBe(validated);
        if (!accepted || !owner) {
            throw new Error('Expected accepted candidate and owner');
        }
        expect(getActorId(accepted)).toBe(ACTOR);
        const bytes = getLastLocalChange(accepted);
        if (!bytes) {
            throw new Error('Expected accepted local change');
        }
        const decoded = decodeChange(bytes);
        expect(decoded.actor).toBe(ACTOR);
        expect(decoded.seq).toBe(2);
        expect(decoded.deps).toEqual(getHeads(original));
        expect(decoded.message).toBe('accepted');
        expect(repository.readOwnedDocumentPublications(owner)).toEqual([{ docId: 'root', heads: getHeads(accepted) }]);
        expect(callbacks.beforePublication).toHaveBeenCalledOnce();
        expect(callbacks.onPublished).toHaveBeenCalledOnce();
        expect(observer).toHaveBeenCalledExactlyOnceWith('root', { localSlots: ['count'] });
        const peer = change(clone(original, { actor: PEER }), (doc) => {
            doc.peer = true;
        });
        expect(toJS(merge(clone(accepted), clone(peer)))).toEqual(toJS(merge(clone(peer), clone(accepted))));
        expect(toJS(merge(clone(accepted), clone(peer)))).toEqual({ count: 1, peer: true });
        repository.changeDoc<State>(
            'root',
            (doc) => {
                doc.count = 2;
            },
            'next',
            undefined,
            undefined,
            validation()
        );
        const next = repository.getDoc<State>('root');
        if (!next) {
            throw new Error('Expected next candidate');
        }
        const nextBytes = getLastLocalChange(next);
        if (!nextBytes) {
            throw new Error('Expected next local change');
        }
        expect(decodeChange(nextBytes)).toMatchObject({ actor: ACTOR, seq: 3, deps: getHeads(accepted) });
    });

    it.each(['mutation', 'validator', 'beforePublication'] as const)(
        'rejects a throwing %s without consuming original authority',
        (phase) => {
            const original = seed();
            const before = epochs();
            const callbacks = validation();
            if (phase === 'validator') {
                callbacks.validateDocument.mockImplementation(() => {
                    throw new Error('stopped');
                });
            }
            if (phase === 'beforePublication') {
                callbacks.beforePublication.mockImplementation(() => {
                    throw new Error('stopped');
                });
            }
            expect(() =>
                repository.changeDoc<State>(
                    'root',
                    (doc) => {
                        doc.count = 9;
                        if (phase === 'mutation') {
                            throw new Error('stopped');
                        }
                    },
                    undefined,
                    undefined,
                    undefined,
                    callbacks
                )
            ).toThrow('stopped');
            expect(repository.getDoc('root')).toBe(original);
            expect(epochs()).toEqual(before);
            expect(callbacks.onPublished).not.toHaveBeenCalled();
            repository.changeDoc<State>('root', (doc) => {
                doc.count = 1;
            });
            expect(repository.getDoc<State>('root')?.count).toBe(1);
        }
    );

    it.each(['mutate', 'replace', 'merge', 'aba'] as const)(
        'refuses validator reentry %s and preserves the newer authority',
        (operation) => {
            const original = seed();
            let surviving: Doc<State> | undefined;
            const callbacks = validation(() => {
                if (operation === 'mutate') {
                    repository.changeDoc<State>('root', (doc) => {
                        doc.peer = true;
                    });
                }
                if (operation === 'replace') {
                    repository.replaceDoc('root', from<State>({ count: 3, replacement: true }));
                }
                if (operation === 'merge') {
                    const peer = change(clone(original, { actor: PEER }), (doc) => {
                        doc.peer = true;
                    });
                    repository.replaceDoc('root', merge(clone(original), peer));
                }
                if (operation === 'aba') {
                    repository.replaceDoc('root', from<State>({ count: 3 }));
                    repository.replaceDoc('root', original);
                }
                surviving = repository.getDoc<State>('root');
            });
            expect(() =>
                repository.changeDoc<State>(
                    'root',
                    (doc) => {
                        doc.count = 999;
                    },
                    undefined,
                    undefined,
                    undefined,
                    callbacks
                )
            ).toThrow('authority changed');
            expect(repository.getDoc('root')).toBe(surviving);
            expect(repository.getDoc<State>('root')?.count).not.toBe(999);
            expect(callbacks.onPublished).not.toHaveBeenCalled();
            repository.changeDoc<State>('root', (doc) => {
                doc.count = 4;
            });
            expect(repository.getDoc<State>('root')?.count).toBe(4);
        }
    );

    it.each(['mutation', 'beforePublication'] as const)('rechecks authority after the %s callback', (phase) => {
        seed();
        const callbacks = validation();
        const replace = (): void => repository.replaceDoc('root', from<State>({ count: 5, replacement: true }));
        if (phase === 'beforePublication') {
            callbacks.beforePublication.mockImplementation(replace);
        }
        expect(() =>
            repository.changeDoc<State>(
                'root',
                (doc) => {
                    doc.count = 999;
                    if (phase === 'mutation') {
                        replace();
                    }
                },
                undefined,
                undefined,
                undefined,
                callbacks
            )
        ).toThrow('authority changed');
        expect(repository.getDoc<State>('root')).toMatchObject({ count: 5, replacement: true });
        expect(callbacks.onPublished).not.toHaveBeenCalled();
    });

    it('admits a no-op candidate without creating an actor operation', () => {
        const original = seed();
        const callbacks = validation();
        repository.changeDoc<State>('root', () => undefined, undefined, undefined, undefined, callbacks);
        const current = repository.getDoc<State>('root');
        if (!current) {
            throw new Error('Expected installed candidate');
        }
        expect(getHeads(current)).toEqual(getHeads(original));
        expect(getActorId(current)).toBe(ACTOR);
        expect(callbacks.onPublished).toHaveBeenCalledOnce();
        repository.changeDoc<State>('root', (doc) => {
            doc.count = 1;
        });
        const next = repository.getDoc<State>('root');
        if (!next) {
            throw new Error('Expected next write');
        }
        const bytes = getLastLocalChange(next);
        if (!bytes) {
            throw new Error('Expected next change');
        }
        expect(decodeChange(bytes).seq).toBe(2);
    });

    it('refuses a reserved snapshot before invoking candidate callbacks', async () => {
        const original = seed();
        const callbacks = validation();
        await repository.transactSnapshot(async (snapshot) => {
            repository.reserveSnapshotTransactionDocuments(snapshot, ['root']);
            expect(() =>
                repository.changeDoc<State>(
                    'root',
                    (doc) => {
                        doc.count = 7;
                    },
                    undefined,
                    undefined,
                    undefined,
                    callbacks
                )
            ).toThrow('overlaps the active snapshot transaction');
        });
        expect(repository.getDoc('root')).toBe(original);
        expect(callbacks.validateDocument).not.toHaveBeenCalled();
    });

    it('acknowledges exact installation before a throwable observer tail', () => {
        seed();
        const callbacks = validation();
        let observed: Doc<State> | undefined;
        callbacks.onPublished.mockImplementation(() => {
            observed = repository.getDoc<State>('root');
        });
        repository.onChange(() => {
            throw new Error('observer');
        });
        vi.spyOn(logger, 'warn').mockImplementation(() => {
            throw new Error('logger after install');
        });
        expect(() =>
            repository.changeDoc<State>(
                'root',
                (doc) => {
                    doc.count = 1;
                },
                undefined,
                undefined,
                undefined,
                callbacks
            )
        ).toThrow('logger after install');
        expect(callbacks.onPublished).toHaveBeenCalledOnce();
        expect(repository.getDoc('root')).toBe(observed);
        expect(observed?.count).toBe(1);
    });
});

describe('separated single-change prospective phases', () => {
    it('keeps clone and change private and installs exactly one same-actor change on validated publication', () => {
        const original = seed();
        const before = epochs();
        const observer = vi.fn();
        repository.onChange(observer);
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            repository.cloneProspectiveMutation<State>(
                'root',
                (draft) => {
                    draft.count = 120;
                },
                'prepared',
                undefined,
                ['count']
            )
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const prepared = transaction.scope(transaction.value.materialize);
        expect(repository.getDoc('root')).toBe(original);
        expect(epochs()).toEqual(before);
        expect(observer).not.toHaveBeenCalled();
        let accepted: Doc<State> | undefined;
        const callbacks = validation((candidate) => {
            accepted = candidate;
        });
        const unused = vi.fn();
        const beforeChange = vi.fn();
        transaction.scope(() =>
            repository.changeDoc<State>(
                'root',
                unused,
                'prepared',
                undefined,
                ['count'],
                {
                    ...callbacks,
                    preparedCandidate: prepared,
                },
                beforeChange
            )
        );
        const installed = repository.getDoc<State>('root');
        expect(installed).toBe(accepted);
        expect(beforeChange).toHaveBeenCalledExactlyOnceWith(original);
        expect(unused).not.toHaveBeenCalled();
        expect(callbacks.onPublished).toHaveBeenCalledOnce();
        expect(observer).toHaveBeenCalledOnce();
        if (!installed) {
            throw new Error('Expected publication');
        }
        const last = getLastLocalChange(installed);
        if (!last) {
            throw new Error('Expected single change');
        }
        const decoded = decodeChange(last);
        expect(decoded.actor).toBe(ACTOR);
        expect(decoded.seq).toBe(2);
        expect(decoded.deps).toEqual(getHeads(original));
        expect(() =>
            transaction.scope(() =>
                prepared.publish({
                    id: 'root',
                    message: 'prepared',
                    snapshotTransaction: undefined,
                    localSlots: ['count'],
                    validation: callbacks,
                })
            )
        ).toThrow('Prospective candidate has already settled');
        transaction.commit();
    });

    it('installs a prepared primary change with its supplemental owner change in one atomic publication', () => {
        const original = seed();
        const observer = vi.fn();
        repository.onChange(observer);
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            repository.cloneProspectiveMutation<State>(
                'root',
                (draft) => {
                    draft.count = 120;
                },
                'prepared',
                undefined,
                ['count']
            )
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const prepared = transaction.scope(transaction.value.materialize);
        const supplemental = vi.fn((draft: State) => {
            draft.replacement = true;
        });
        const beforeChange = vi.fn();
        const callbacks = validation((candidate) => {
            expect(candidate.count).toBe(120);
            expect(candidate.replacement).toBe(true);
            expect(repository.getDoc('root')).toBe(original);
        });
        transaction.scope(() =>
            repository.changeDoc<State>(
                'root',
                () => {
                    throw new Error('The prepared primary change recomputed on the main thread');
                },
                'prepared',
                undefined,
                ['count', 'replacement'],
                {
                    ...callbacks,
                    preparedCandidate: prepared,
                    preparedCandidateChangeFn: supplemental,
                },
                beforeChange
            )
        );

        const installed = repository.getDoc<State>('root');
        expect(installed?.count).toBe(120);
        expect(installed?.replacement).toBe(true);
        expect(beforeChange).toHaveBeenCalledExactlyOnceWith(original);
        expect(supplemental).toHaveBeenCalledOnce();
        expect(callbacks.validateDocument).toHaveBeenCalledOnce();
        expect(callbacks.beforePublication).toHaveBeenCalledOnce();
        expect(callbacks.onPublished).toHaveBeenCalledOnce();
        expect(observer).toHaveBeenCalledExactlyOnceWith('root', { localSlots: ['count', 'replacement'] });
        if (!installed) {
            throw new Error('Expected installed candidate');
        }
        const additions = getChangesMetaSince(installed, getHeads(original));
        expect(additions).toHaveLength(2);
        expect(additions.map(({ actor, seq }) => ({ actor, seq }))).toEqual([
            { actor: ACTOR, seq: 2 },
            { actor: ACTOR, seq: 3 },
        ]);
        expect(additions[0]?.deps).toEqual(getHeads(original));
        expect(additions[1]?.deps).toEqual([additions[0]?.hash]);
        transaction.commit();
    });

    it('rejects a separated candidate without snapshot, observer or actor footprints', async () => {
        const original = seed();
        const before = epochs();
        const observer = vi.fn();
        repository.onChange(observer);
        const callbacks = validation(() => {
            throw new Error('full prepared validator refused');
        });
        const snapshots = await repository.transactSnapshot(async (snapshot) => {
            const transaction = runWithAutomergeStorageTransaction(undefined, () =>
                repository.cloneProspectiveMutation<State>(
                    'root',
                    (draft) => {
                        draft.count = 9;
                    },
                    'prepared refusal',
                    snapshot,
                    ['count']
                )
            );
            if (transaction.status !== 'returned') {
                throw transaction.error;
            }
            const prepared = transaction.scope(transaction.value.materialize);
            expect(() =>
                transaction.scope(() =>
                    repository.changeDoc<State>('root', () => undefined, 'prepared refusal', snapshot, ['count'], {
                        ...callbacks,
                        preparedCandidate: prepared,
                    })
                )
            ).toThrow('full prepared validator refused');
            transaction.abort();
        });
        expect(snapshots.before.size).toBe(0);
        expect(snapshots.after.size).toBe(0);
        expect(repository.getDoc('root')).toBe(original);
        expect(epochs()).toEqual(before);
        expect(observer).not.toHaveBeenCalled();
        expect(callbacks.beforePublication).not.toHaveBeenCalled();
        expect(callbacks.onPublished).not.toHaveBeenCalled();
        repository.changeDoc<State>('root', (draft) => {
            draft.count = 1;
        });
        expect(repository.getDoc<State>('root')?.count).toBe(1);
    });

    it.each(['replace', 'mutate', 'peer ABA'] as const)('refuses a stale private candidate after %s', (kind) => {
        const original = seed();
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            repository.cloneProspectiveMutation<State>('root', (draft) => {
                draft.count = 1;
            })
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const prepared = transaction.scope(transaction.value.materialize);
        if (kind === 'mutate') {
            repository.changeDoc<State>('root', (draft) => {
                draft.peer = true;
            });
        } else {
            repository.insertDoc(
                'root',
                change(clone(original, { actor: PEER }), (draft) => {
                    draft.peer = true;
                })
            );
            if (kind === 'peer ABA') {
                repository.insertDoc('root', original);
            }
        }
        const foreign = repository.getDoc('root');
        expect(prepared.isCurrent()).toBe(false);
        expect(() =>
            transaction.scope(() =>
                repository.changeDoc<State>('root', () => undefined, undefined, undefined, undefined, {
                    ...validation(),
                    preparedCandidate: prepared,
                })
            )
        ).toThrow('authority changed');
        expect(repository.getDoc('root')).toBe(foreign);
        transaction.abort();
    });

    it('refuses reentrant full validation of an already materialized candidate', () => {
        const original = seed();
        const transaction = runWithAutomergeStorageTransaction(undefined, () =>
            repository.cloneProspectiveMutation<State>('root', (draft) => {
                draft.count = 2;
            })
        );
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const prepared = transaction.scope(transaction.value.materialize);
        const callbacks = validation(() => repository.insertDoc('root', clone(original, { actor: PEER })));
        expect(() =>
            transaction.scope(() =>
                repository.changeDoc<State>('root', () => undefined, undefined, undefined, undefined, {
                    ...callbacks,
                    preparedCandidate: prepared,
                })
            )
        ).toThrow('authority changed');
        expect(callbacks.onPublished).not.toHaveBeenCalled();
        expect(repository.getDoc<State>('root')?.count).toBe(0);
        transaction.abort();
    });
});

it('acknowledges a privately prepared candidate before a throwable observer tail', () => {
    seed();
    const transaction = runWithAutomergeStorageTransaction(undefined, () =>
        repository.cloneProspectiveMutation<State>('root', (draft) => {
            draft.count = 3;
        })
    );
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    const prepared = transaction.scope(transaction.value.materialize);
    const callbacks = validation();
    let installed: Doc<State> | undefined;
    callbacks.onPublished.mockImplementation(() => {
        installed = repository.getDoc<State>('root');
    });
    repository.onChange(() => {
        throw new Error('observer');
    });
    vi.spyOn(logger, 'warn').mockImplementation(() => {
        throw new Error('logger after install');
    });
    expect(() =>
        transaction.scope(() =>
            repository.changeDoc<State>('root', () => undefined, undefined, undefined, undefined, {
                ...callbacks,
                preparedCandidate: prepared,
            })
        )
    ).toThrow('logger after install');
    expect(callbacks.onPublished).toHaveBeenCalledOnce();
    expect(repository.getDoc('root')).toBe(installed);
    expect(installed?.count).toBe(3);
    transaction.abort();
});
