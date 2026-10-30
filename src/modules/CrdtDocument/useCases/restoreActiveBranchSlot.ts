import { automergeRepository } from '../repositories/automergeRepository';
import { branchStore } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

export function restoreActiveBranchSlot(): void {
    const state = branchStore.value;
    if (!state) {
        return;
    }

    const active = state.branches.find((branch) => branch.branchId === state.activeBranchId);
    if (!active || active.rootDocId === DOC_PREFIX_ROOT) {
        return;
    }

    const branchDoc = automergeRepository.getDoc(active.rootDocId);
    if (!branchDoc) {
        return;
    }

    automergeRepository.replaceDoc(DOC_PREFIX_ROOT, branchDoc);
}
