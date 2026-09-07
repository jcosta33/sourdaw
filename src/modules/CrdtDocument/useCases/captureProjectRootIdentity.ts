import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Capture the runtime identity of the installed active root document. The value
 * is only meaningful for comparisons within this repository runtime; it is not
 * a persisted project identifier.
 */
export function captureProjectRootIdentity(): string {
    return JSON.stringify({ rootIdentityEpoch: automergeRepository.getRootIdentityEpoch() });
}
