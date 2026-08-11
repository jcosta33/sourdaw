import { DOC_PREFIX_ROOT } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';
import { branchStore } from '../stores/branchStore';

export function captureActiveBranchReference() {
    const state = branchStore.value;
    const root = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!state || !root) {
        return null;
    }
    return {
        activeBranchId: state.activeBranchId,
        branchState: structuredClone(state),
        documents: automergeRepository
            .getDocIds()
            .toSorted()
            .map((docId) => ({
                docId,
                heads: [...(automergeRepository.getHeads(docId) ?? [])].map(String).toSorted(),
            })),
        rootHeads: [...(automergeRepository.getHeads(DOC_PREFIX_ROOT) ?? [])].map(String).toSorted(),
    };
}
