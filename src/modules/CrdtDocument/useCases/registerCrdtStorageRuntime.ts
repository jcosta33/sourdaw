import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../repositories/automergeRepository';
import { getSemanticContext } from '../stores/semanticChangeContext';

import { getCrdtDoc } from './getCrdtDoc';
import { hasCrdtDoc } from './hasCrdtDoc';
import { mutateCrdtDoc } from './mutateCrdtDoc';

type StorageRuntimeDoc = {
    [key: string]: unknown;
};

export function registerCrdtStorageRuntime(): void {
    configureAutomergeStoragePort({
        getDoc: (docId) => getCrdtDoc<StorageRuntimeDoc>(docId),
        getSemanticMessage: () => getSemanticContext()?.message,
        hasDoc: (docId) => hasCrdtDoc(docId),
        mutateDoc: ({ docId, changeFn, message, snapshotTransaction }) => {
            mutateCrdtDoc<StorageRuntimeDoc>({
                id: docId,
                changeFn,
                message,
                snapshotTransaction,
            });
        },
        waitForSnapshotTransaction: (snapshotTransaction) =>
            automergeRepository.waitForSnapshotTransaction(snapshotTransaction),
    });
}
