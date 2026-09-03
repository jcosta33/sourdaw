import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture the identity of the loaded project: stable across an ordinary in-place mutation, and
 * moved whenever the CRDT document set is replaced or its membership changes — project
 * replacement (`resetCrdtProjectAuthority`), a branch fork/switch/transition, document removal,
 * and the other calls to `markDocumentIdentityMutation` in `automergeRepository.ts`. A sync that
 * lands in the stored doc's own lineage (`replaceCrdtDocInLineage`, used by Collaboration for an
 * applied sync or a rollback) leaves this unchanged, since nothing about project membership or
 * lineage moved. Pair this with `captureProjectRevision`, which answers "same state": a caller
 * that needs "same project" reaches for this instead.
 */
export function captureProjectIdentity(): string {
    return JSON.stringify({ documentIdentityEpoch: automergeRepository.getDocumentIdentityEpoch() });
}
