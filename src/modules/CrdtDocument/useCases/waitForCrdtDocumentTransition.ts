import {
    branchDocumentTransitionFence,
    type BranchDocumentTransitionOutcome,
} from './crdtBranching/branchDocumentTransitionFence';

export function waitForCrdtDocumentTransition(docId: string): Promise<BranchDocumentTransitionOutcome> | null {
    return branchDocumentTransitionFence.wait(docId);
}
