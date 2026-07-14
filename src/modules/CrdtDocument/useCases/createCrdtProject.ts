import { automergeRepository } from '../repositories/automergeRepository';
import { branchStore, MAIN_BRANCH_ID } from '../stores/branchStore';

import { compactProject } from './compactProject';
import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

/**
 * Create a new CRDT-backed project.
 */
export async function createCrdtProject(name: string): Promise<void> {
    automergeRepository.createProject(name);
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
    await compactProject();
}
