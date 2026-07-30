import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture the complete local Automerge authority used to plan an AI command.
 * Monotonic mutation and identity epochs prevent exact-state and project-replacement ABA.
 */
export function captureProjectRevision(): string {
    const documents = automergeRepository
        .getDocIds()
        .toSorted()
        .map((docId) => ({
            docId,
            heads: [...(automergeRepository.getHeads(docId) ?? [])].toSorted(),
        }));

    return JSON.stringify({
        documentIdentityEpoch: automergeRepository.getDocumentIdentityEpoch(),
        mutationEpoch: automergeRepository.getMutationEpoch(),
        documents,
    });
}
