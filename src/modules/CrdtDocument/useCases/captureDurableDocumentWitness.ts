import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture a durable identity for the current document state: sorted doc ids,
 * each with its sorted Automerge heads. Heads are content-addressed change
 * hashes, so two captures are equal iff every change is present in both —
 * unlike `captureProjectRevision`, this carries no `documentIdentityEpoch` or
 * `mutationEpoch`, which are session-local counters that never survive a
 * reload and would make a freshly restored document compare unequal to the
 * one that produced it.
 */
export function captureDurableDocumentWitness(): string {
    const documents = automergeRepository
        .getDocIds()
        .toSorted()
        .map((docId) => ({
            docId,
            heads: [...(automergeRepository.getHeads(docId) ?? [])].toSorted(),
        }));

    return JSON.stringify({ documents });
}
