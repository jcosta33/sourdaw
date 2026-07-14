import { automergeRepository } from '../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

export function resetCrdtProjectAuthority(name: string): void {
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
    automergeRepository.createProject(name);
}
