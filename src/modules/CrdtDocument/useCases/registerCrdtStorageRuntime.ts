import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../repositories/automergeRepository';
import { getSemanticContext } from '../stores/semanticChangeContext';

import { cloneProspectiveCrdtMutation } from './cloneProspectiveCrdtMutation';
import { getCrdtDoc } from './getCrdtDoc';
import { hasCrdtDoc } from './hasCrdtDoc';
import { mutateCrdtDoc } from './mutateCrdtDoc';

type StorageRuntimeDoc = {
    [key: string]: unknown;
};

type StorageRuntimeCandidate = ReturnType<
    ReturnType<typeof cloneProspectiveCrdtMutation<StorageRuntimeDoc>>['materialize']
>;

type StorageRuntimeValidatedInput = Parameters<
    NonNullable<NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>['mutateDocValidated']>
>[0];

function mutateCrdtDocValidated(
    candidates: WeakMap<object, StorageRuntimeCandidate>,
    input: StorageRuntimeValidatedInput
): void {
    const {
        docId,
        changedKeys,
        changeFn,
        message,
        snapshotTransaction,
        beforeChange,
        validateDocument,
        beforePublication,
        onPublished,
        preparedCandidate,
        preparedCandidateChangeFn,
    } = input;
    let candidate: StorageRuntimeCandidate | undefined;
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
        if (preparedCandidateChangeFn) {
            prospectiveValidation.preparedCandidateChangeFn = preparedCandidateChangeFn;
        }
    }
    try {
        mutateCrdtDoc<StorageRuntimeDoc>({
            id: docId,
            changeFn,
            message,
            snapshotTransaction,
            localSlots: changedKeys,
            prospectiveValidation,
            beforeChange,
        });
    } finally {
        if (preparedCandidate) {
            candidates.delete(preparedCandidate);
            candidate?.discard();
        }
    }
}

export function registerCrdtStorageRuntime(): void {
    const candidates = new WeakMap<object, StorageRuntimeCandidate>();
    configureAutomergeStoragePort({
        getDoc: (docId) => getCrdtDoc<StorageRuntimeDoc>(docId),
        getDocHeads: (docId) => automergeRepository.getHeads(docId),
        getSemanticMessage: () => getSemanticContext()?.message,
        hasDoc: (docId) => hasCrdtDoc(docId),
        isMutationBlockedBySnapshotTransaction: (docId, snapshotTransaction) =>
            automergeRepository.isMutationBlockedBySnapshotTransaction(docId, snapshotTransaction),
        mutateDoc: ({ docId, changedKeys, changeFn, message, snapshotTransaction, beforeChange }) => {
            mutateCrdtDoc<StorageRuntimeDoc>({
                id: docId,
                changeFn,
                beforeChange,
                message,
                snapshotTransaction,
                localSlots: changedKeys,
            });
        },
        cloneDocForMutation: ({ docId, changedKeys, changeFn, message, snapshotTransaction, canonicalMutation }) => {
            const cloned = cloneProspectiveCrdtMutation<StorageRuntimeDoc>({
                id: docId,
                localSlots: changedKeys,
                changeFn,
                message,
                snapshotTransaction,
                canonicalMutation,
            });
            return {
                requestMaterialization: cloned.requestMaterialization,
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
        mutateDocValidated: (input) => mutateCrdtDocValidated(candidates, input),
        waitForSnapshotTransaction: (snapshotTransaction) =>
            automergeRepository.waitForSnapshotTransaction(snapshotTransaction),
    });
}
