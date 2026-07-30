import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture the complete local Automerge authority used to plan an AI command.
 * The identity epoch distinguishes replacement projects with equivalent heads.
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
        documents,
    });
}
