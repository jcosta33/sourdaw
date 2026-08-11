import { branchDocumentTransitionFence } from './crdtBranching/branchDocumentTransitionFence';

export function waitForCrdtDocumentTransition(docId: string): Promise<void> | null {
    return branchDocumentTransitionFence.wait(docId);
}
