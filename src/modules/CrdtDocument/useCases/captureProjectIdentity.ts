import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture the identity of the loaded project: stable across ordinary mutations, and changed only
 * when the document identity epoch moves (project replacement — `resetCrdtProjectAuthority`,
 * `replaceCrdtDoc`, and the other calls to `markDocumentIdentityMutation` in
 * `automergeRepository.ts`). Pair it with `captureProjectRevision`, which answers "same state":
 * a caller that needs "same project" reaches for this instead.
 */
export function captureProjectIdentity(): string {
    return JSON.stringify({ documentIdentityEpoch: automergeRepository.getDocumentIdentityEpoch() });
}
