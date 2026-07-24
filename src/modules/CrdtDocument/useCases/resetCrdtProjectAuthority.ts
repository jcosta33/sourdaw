import {
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { automergeRepository } from '../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { runCrdtPersistenceOperation } from './runCrdtPersistenceOperation';

export function resetCrdtProjectAuthority(name: string): void {
    resetActionReplayAuthority();
    // Drain writes owned by the outgoing repository before replacing its root.
    // The branch update below must then be the first store write observed by
    // the new authority.
    flushAutomergeStorageWrites();
    void runCrdtPersistenceOperation('reset');
    automergeRepository.createProject(name);
    // Audit CC-2 — the outgoing project's projected caches must not survive the
    // authority switch. Left in place they are the stale-bleed source: the
    // first projection against the fresh document would carry the previous
    // project's tracks/automation/markers into it.
    resetAutomergeStorageProjections(DOC_PREFIX_ROOT);
    branchStore.set({
        branches: [
            {
                branchId: MAIN_BRANCH_ID,
                name: 'Main',
                rootDocId: DOC_PREFIX_ROOT,
                sourceBranchId: null,
                createdAt: Date.now(),
                createdFromHeads: [],
                note: '',
            },
        ],
        activeBranchId: MAIN_BRANCH_ID,
    });
}
