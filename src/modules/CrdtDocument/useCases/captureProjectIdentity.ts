import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture the identity of the loaded project: stable across an ordinary in-place mutation, and
 * moved whenever the CRDT document set is replaced or its membership changes — project
 * replacement (`resetCrdtProjectAuthority`), an applied remote sync landing through
 * `replaceCrdtDoc`, a branch fork/switch/transition, document removal, and the other calls to
 * `markDocumentIdentityMutation` in `automergeRepository.ts`. A caller that reads this to bind an
 * AI proposal's identity therefore still sees an unrelated edit as a different project when that
 * edit arrives through one of those routes, even though it changes nothing the proposal targets;
 * narrowing that confirm-time divergence check is tracked as #3456. Pair this with
 * `captureProjectRevision`, which answers "same state": a caller that needs "same project" reaches
 * for this instead.
 */
export function captureProjectIdentity(): string {
    return JSON.stringify({ documentIdentityEpoch: automergeRepository.getDocumentIdentityEpoch() });
}
