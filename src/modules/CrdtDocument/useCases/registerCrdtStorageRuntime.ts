import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../repositories/automergeRepository';
import { getSemanticContext } from '../stores/semanticChangeContext';

import { getCrdtDoc } from './getCrdtDoc';
import { hasCrdtDoc } from './hasCrdtDoc';
import { cloneProspectiveCrdtMutation, mutateCrdtDoc } from './mutateCrdtDoc';

type StorageRuntimeDoc = {
    [key: string]: unknown;
};

export function registerCrdtStorageRuntime(): void {
    type Candidate = ReturnType<ReturnType<typeof cloneProspectiveCrdtMutation<StorageRuntimeDoc>>['materialize']>;
    const candidates = new WeakMap<object, Candidate>();
    configureAutomergeStoragePort({
        getDoc: (docId) => getCrdtDoc<StorageRuntimeDoc>(docId),
        getDocHeads: (docId) => automergeRepository.getHeads(docId),
        getSemanticMessage: () => getSemanticContext()?.message,
        hasDoc: (docId) => hasCrdtDoc(docId),
        isMutationBlockedBySnapshotTransaction: (docId, snapshotTransaction) =>
            automergeRepository.isMutationBlockedBySnapshotTransaction(docId, snapshotTransaction),
        mutateDoc: ({ docId, changedKeys, changeFn, message, snapshotTransaction }) => {
            mutateCrdtDoc<StorageRuntimeDoc>({
                id: docId,
                changeFn,
                message,
                snapshotTransaction,
                localSlots: changedKeys,
            });
        },
        cloneDocForMutation: ({ docId, changedKeys, changeFn, message, snapshotTransaction }) => {
            const cloned = cloneProspectiveCrdtMutation<StorageRuntimeDoc>({
                id: docId,
                localSlots: changedKeys,
                changeFn,
                message,
                snapshotTransaction,
            });
            return {
                isCurrent: cloned.isCurrent,
                discard: cloned.discard,
                materialize: () => {
                    const candidate = cloned.materialize();
                    const token = Object.freeze({});
                    candidates.set(token, candidate);
                    return {
                        token,
                        isCurrent: candidate.isCurrent,
                        discard: () => {
                            candidates.delete(token);
                            candidate.discard();
                        },
                    };
                },
            };
        },
        mutateDocValidated: ({
            docId,
            changedKeys,
            changeFn,
            message,
            snapshotTransaction,
            validateDocument,
            beforePublication,
            onPublished,
            preparedCandidate,
        }) => {
            let candidate: Candidate | undefined;
            if (preparedCandidate) {
                candidate = candidates.get(preparedCandidate);
            }
            if (preparedCandidate && !candidate) {
                throw new Error('Prepared storage candidate is unknown to the registered runtime');
            }
            const prospectiveValidation: NonNullable<
                Parameters<typeof mutateCrdtDoc<StorageRuntimeDoc>>[0]['prospectiveValidation']
            > = {
                validateDocument,
                beforePublication,
                onPublished,
            };
            if (candidate) {
                prospectiveValidation.preparedCandidate = candidate;
            }
            try {
                mutateCrdtDoc<StorageRuntimeDoc>({
                    id: docId,
                    changeFn,
                    message,
                    snapshotTransaction,
                    localSlots: changedKeys,
                    prospectiveValidation,
                });
            } finally {
                if (preparedCandidate) {
                    candidates.delete(preparedCandidate);
                    candidate?.discard();
                }
            }
        },
        waitForSnapshotTransaction: (snapshotTransaction) =>
            automergeRepository.waitForSnapshotTransaction(snapshotTransaction),
    });
}
