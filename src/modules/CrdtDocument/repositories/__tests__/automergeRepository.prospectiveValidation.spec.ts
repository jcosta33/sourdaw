import {
    change,
    clone,
    decodeChange,
    from,
    getActorId,
    getHeads,
    getLastLocalChange,
    merge,
    toJS,
    type Doc,
} from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import {
    getCurrentAutomergeStorageMutationOwner,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository as repository } from '../automergeRepository';

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

beforeEach(() => repository.reset());
afterEach(() => {
    vi.restoreAllMocks();
    repository.reset();
});

describe('private prospective Automerge candidates', () => {
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
