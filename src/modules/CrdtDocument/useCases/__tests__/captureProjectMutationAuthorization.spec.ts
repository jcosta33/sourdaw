import { change } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    getCurrentAutomergeStorageMutationOwner,
    resetAutomergeStorageProjections,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectMutationAuthorization } from '../captureProjectMutationAuthorization';

beforeEach(() => {
    automergeRepository.reset();
    automergeRepository.createProject('project');
});

afterEach(() => {
    configureAutomergeStoragePort(null);
    resetAutomergeStorageProjections('root');
    flushAutomergeStorageWrites();
});

function installRealStoragePort(): void {
    configureAutomergeStoragePort({
        getDoc: (docId) => automergeRepository.getDoc<Record<string, unknown>>(docId),
        getDocHeads: (docId) => automergeRepository.getHeads(docId),
        getSemanticMessage: () => undefined,
        hasDoc: (docId) => automergeRepository.hasDoc(docId),
        isMutationBlockedBySnapshotTransaction: (docId, snapshotTransaction) =>
            automergeRepository.isMutationBlockedBySnapshotTransaction(docId, snapshotTransaction),
        mutateDoc: ({ docId, changeFn, message, changedKeys, snapshotTransaction }) =>
            automergeRepository.changeDoc(docId, changeFn, message, snapshotTransaction, changedKeys),
    });
}

describe('captureProjectMutationAuthorization', () => {
    it('keeps mutations from the bound storage transaction owner authorized', () => {
        const isAuthorized = captureProjectMutationAuthorization();
        const authorizations: boolean[] = [];

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            authorizations.push(isAuthorized());

            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.firstOwnedMutation = true;
            });
            authorizations.push(isAuthorized());

            automergeRepository.createChildDoc('owned-child');
            authorizations.push(isAuthorized());
        });
        transaction.commit();

        expect(transaction.status).toBe('returned');
        expect(authorizations).toEqual([true, true, true]);
        expect(isAuthorized()).toBe(true);
    });

    it('revokes authorization after a different storage transaction owner mutates the project', () => {
        const isAuthorized = captureProjectMutationAuthorization();
        let authorizationAfterOwnedMutation = false;
        const boundTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            isAuthorized();
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.ownedMutation = true;
            });
            authorizationAfterOwnedMutation = isAuthorized();
        });
        boundTransaction.commit();

        let authorizationAfterForeignMutation = true;
        const foreignTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.foreignMutation = true;
            });
            authorizationAfterForeignMutation = isAuthorized();
        });
        foreignTransaction.commit();

        expect(boundTransaction.status).toBe('returned');
        expect(foreignTransaction.status).toBe('returned');
        expect(authorizationAfterOwnedMutation).toBe(true);
        expect(authorizationAfterForeignMutation).toBe(false);
    });

    it('keeps a synchronous same-lineage listener replacement outside its publisher owner', () => {
        const ownsPublication = captureProjectMutationAuthorization();
        const rootIdentity = automergeRepository.getRootIdentityEpoch();
        const totalBefore = automergeRepository.getMutationEpoch();
        let outerOwner: object | undefined;
        let listenerOwner: object | undefined;
        const unsubscribe = automergeRepository.onChange(() => {
            unsubscribe();
            listenerOwner = getCurrentAutomergeStorageMutationOwner();
            const current = automergeRepository.getDoc<Record<string, unknown>>('root');
            if (!current) {
                throw new Error('Expected current root');
            }
            automergeRepository.replaceDocInLineage(
                'root',
                change(current, (draft) => {
                    draft.peerReplacement = true;
                })
            );
        });

        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            outerOwner = getCurrentAutomergeStorageMutationOwner();
            expect(ownsPublication()).toBe(true);
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.publisher = true;
            });
            expect(getCurrentAutomergeStorageMutationOwner()).toBe(outerOwner);
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.publisherAfterListener = true;
            });
        });
        transaction.commit();

        expect(transaction.status).toBe('returned');
        expect(outerOwner).toBeDefined();
        expect(listenerOwner).toBeUndefined();
        expect(automergeRepository.getRootIdentityEpoch()).toBe(rootIdentity);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            publisher: true,
            peerReplacement: true,
            publisherAfterListener: true,
        });
        expect(automergeRepository.getMutationEpoch()).toBe(totalBefore + 3);
        expect(automergeRepository.getMutationEpochForOwner(outerOwner!)).toBe(2);
        expect(ownsPublication()).toBe(false);
    });

    it('excludes a listener replacement from a delayed adapter publication provenance', () => {
        automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
            draft.state = { count: 0 };
        });
        installRealStoragePort();
        const storage = createAutomergeStorage<{ count: number }>('root', 'state');
        expect(storage.hydrate?.()).toBe(true);
        const ownsPublication = captureProjectMutationAuthorization();
        let writerOwner: object | undefined;
        let listenerOwner: object | undefined;
        const unsubscribe = automergeRepository.onChange(() => {
            unsubscribe();
            listenerOwner = getCurrentAutomergeStorageMutationOwner();
            const current = automergeRepository.getDoc<Record<string, unknown>>('root');
            if (!current) {
                throw new Error('Expected current root');
            }
            automergeRepository.replaceDocInLineage(
                'root',
                change(current, (draft) => {
                    draft.peerReplacement = true;
                })
            );
        });
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            writerOwner = getCurrentAutomergeStorageMutationOwner();
            expect(ownsPublication()).toBe(true);
            storage.set({ count: 1 });
        });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ state: { count: 0 } });
        transaction.commit();

        expect(transaction.status).toBe('returned');
        expect(writerOwner).toBeDefined();
        expect(listenerOwner).toBeUndefined();
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            state: { count: 1 },
            peerReplacement: true,
        });
        expect(automergeRepository.getMutationEpochForOwner(writerOwner!)).toBe(1);
        expect(ownsPublication()).toBe(false);
    });

    it('lets a listener explicit nested transaction bind its distinct direct and buffered writes', () => {
        automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
            draft.state = { count: 0 };
            draft.nestedState = { count: 0 };
        });
        installRealStoragePort();
        const outerStorage = createAutomergeStorage<{ count: number }>('root', 'state');
        const nestedStorage = createAutomergeStorage<{ count: number }>('root', 'nestedState');
        expect(outerStorage.hydrate?.()).toBe(true);
        expect(nestedStorage.hydrate?.()).toBe(true);
        const outerAuthorization = captureProjectMutationAuthorization();
        let outerOwner: object | undefined;
        let nestedOwner: object | undefined;
        let nestedAuthorization = false;
        const unsubscribe = automergeRepository.onChange(() => {
            unsubscribe();
            const ownsNested = captureProjectMutationAuthorization();
            const nested = runWithAutomergeStorageTransaction(undefined, () => {
                nestedOwner = getCurrentAutomergeStorageMutationOwner();
                expect(ownsNested()).toBe(true);
                automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                    draft.nestedDirect = true;
                });
                nestedStorage.set({ count: 1 });
            });
            nested.commit();
            nestedAuthorization = ownsNested();
        });
        const outer = runWithAutomergeStorageTransaction(undefined, () => {
            outerOwner = getCurrentAutomergeStorageMutationOwner();
            expect(outerAuthorization()).toBe(true);
            outerStorage.set({ count: 1 });
        });
        outer.commit();

        expect(outer.status).toBe('returned');
        expect(outerOwner).toBeDefined();
        expect(nestedOwner).toBeDefined();
        expect(nestedOwner).not.toBe(outerOwner);
        expect(nestedAuthorization).toBe(true);
        expect(automergeRepository.getMutationEpochForOwner(outerOwner!)).toBe(1);
        expect(automergeRepository.getMutationEpochForOwner(nestedOwner!)).toBe(2);
        expect(outerAuthorization()).toBe(false);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            state: { count: 1 },
            nestedDirect: true,
            nestedState: { count: 1 },
        });
    });

    it('restores ambient ownership after a throwing listener and keeps subsequent listeners separate', () => {
        const outerAuthorization = captureProjectMutationAuthorization();
        let outerOwner: object | undefined;
        let throwingOwner: object | undefined;
        let followingOwner: object | undefined;
        const unsubscribeThrowing = automergeRepository.onChange(() => {
            unsubscribeThrowing();
            throwingOwner = getCurrentAutomergeStorageMutationOwner();
            throw new Error('Controlled listener failure');
        });
        const unsubscribeFollowing = automergeRepository.onChange(() => {
            unsubscribeFollowing();
            followingOwner = getCurrentAutomergeStorageMutationOwner();
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.listener = true;
            });
        });
        const outer = runWithAutomergeStorageTransaction(undefined, () => {
            outerOwner = getCurrentAutomergeStorageMutationOwner();
            expect(outerAuthorization()).toBe(true);
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.outer = true;
            });
            expect(getCurrentAutomergeStorageMutationOwner()).toBe(outerOwner);
            automergeRepository.changeDoc<Record<string, unknown>>('root', (draft) => {
                draft.outerAfterListener = true;
            });
        });
        outer.commit();

        expect(outer.status).toBe('returned');
        expect(throwingOwner).toBeUndefined();
        expect(followingOwner).toBeUndefined();
        expect(automergeRepository.getMutationEpochForOwner(outerOwner!)).toBe(2);
        expect(automergeRepository.getUnownedMutationEpoch()).toBeGreaterThan(0);
        expect(outerAuthorization()).toBe(false);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({
            outer: true,
            listener: true,
            outerAfterListener: true,
        });
    });
});
