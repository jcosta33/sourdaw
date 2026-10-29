import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    getCurrentAutomergeStorageMutationOwner,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { createCrdtDoc } from '../createCrdtDoc';
import { getCrdtDoc } from '../getCrdtDoc';
import { mutateCrdtDoc } from '../mutateCrdtDoc';
import { readOwnedProjectPublications } from '../readOwnedProjectPublications';
import { removeCrdtDoc } from '../removeCrdtDoc';
import { replaceCrdtDocInLineage } from '../replaceCrdtDocInLineage';
import { subscribeToCrdtChanges } from '../subscribeToCrdtChanges';

describe('readOwnedProjectPublications', () => {
    beforeEach(() => {
        removeCrdtDoc('root');
        removeCrdtDoc('owned-child');
        createCrdtDoc('root');
        createCrdtDoc('owned-child');
    });

    afterEach(() => {
        removeCrdtDoc('root');
        removeCrdtDoc('owned-child');
    });

    it('records the installed owned heads before a listener publishes a peer descendant', () => {
        let owner: object | undefined;
        let seenInListener: ReturnType<typeof readOwnedProjectPublications> = [];
        let originalHeads: string[] = [];
        let replaced = false;
        const unsubscribe = subscribeToCrdtChanges((docId) => {
            if (docId !== 'root' || !owner || replaced) {
                return;
            }
            const current = getCrdtDoc('root');
            if (!current) {
                return;
            }
            replaced = true;
            seenInListener = readOwnedProjectPublications(owner);
            originalHeads = Automerge.getHeads(current);
            replaceCrdtDocInLineage({
                id: 'root',
                doc: Automerge.change(Automerge.clone(current), (draft) => {
                    draft.peer = true;
                }),
            });
        });
        try {
            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                owner = getCurrentAutomergeStorageMutationOwner();
                mutateCrdtDoc({
                    id: 'root',
                    changeFn: (draft) => {
                        draft.owned = true;
                    },
                });
            });
            expect(transaction.status).toBe('returned');
            transaction.commit();
        } finally {
            unsubscribe();
        }
        if (!owner) {
            throw new Error('Expected a real execution owner');
        }
        expect(replaced).toBe(true);
        expect(seenInListener).toEqual([{ docId: 'root', heads: originalHeads }]);
        expect(readOwnedProjectPublications(owner)).toEqual(seenInListener);
        expect(Automerge.getHeads(getCrdtDoc('root')!)).not.toEqual(originalHeads);
        expect(Automerge.hasHeads(getCrdtDoc('root')!, originalHeads)).toBe(true);
    });

    it('retains every immutable owned publication across documents without adopting foreign writes', () => {
        let owner: object | undefined;
        let first: ReturnType<typeof readOwnedProjectPublications> = [];
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            owner = getCurrentAutomergeStorageMutationOwner();
            mutateCrdtDoc({
                id: 'root',
                changeFn: (draft) => {
                    draft.first = true;
                },
            });
            first = readOwnedProjectPublications(owner!);
            mutateCrdtDoc({
                id: 'owned-child',
                changeFn: (draft) => {
                    draft.child = true;
                },
            });
            mutateCrdtDoc({
                id: 'root',
                changeFn: (draft) => {
                    draft.second = true;
                },
            });
        });
        expect(transaction.status).toBe('returned');
        transaction.commit();
        if (!owner) {
            throw new Error('Expected a real execution owner');
        }
        const publications = readOwnedProjectPublications(owner);
        expect(publications.map((publication) => publication.docId)).toEqual(['root', 'owned-child', 'root']);
        expect(first).toHaveLength(1);
        expect(Object.isFrozen(publications)).toBe(true);
        expect(
            publications.every((publication) => Object.isFrozen(publication) && Object.isFrozen(publication.heads))
        ).toBe(true);
        mutateCrdtDoc({
            id: 'root',
            changeFn: (draft) => {
                draft.unscopedPeer = true;
            },
        });
        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            mutateCrdtDoc({
                id: 'owned-child',
                changeFn: (draft) => {
                    draft.foreignOwner = true;
                },
            });
        });
        foreign.commit();
        expect(readOwnedProjectPublications(owner)).toBe(publications);
        expect(publications[0]?.heads).not.toEqual(publications[2]?.heads);
    });

    it('records no publication for a no-write change', () => {
        let owner: object | undefined;
        const heads = Automerge.getHeads(getCrdtDoc('root')!);
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            owner = getCurrentAutomergeStorageMutationOwner();
            mutateCrdtDoc({ id: 'root', changeFn: () => undefined });
        });
        expect(transaction.status).toBe('returned');
        transaction.commit();
        if (!owner) {
            throw new Error('Expected a real execution owner');
        }
        expect(readOwnedProjectPublications(owner)).toEqual([]);
        expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(heads);
    });
});
