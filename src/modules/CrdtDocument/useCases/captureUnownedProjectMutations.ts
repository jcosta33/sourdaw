import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Count the project mutations no in-flight action authored.
 *
 * `captureProjectRevision` answers "is the project exactly as it was", which
 * an executing batch falsifies with its own first action: a handler write, or
 * a reactive subscriber flushing that write, moves the document heads. An
 * in-flight authorization check that reads a moved revision as outside
 * interference therefore aborts the batch on its own side effect.
 *
 * This counter moves only for mutations not owned by an action — a
 * collaborator patch, a direct unscoped document write, project replacement,
 * or an unscoped buffered storage write flushed by unrelated work. Pending
 * writes retain the ownership captured when they were created; the ambient
 * caller that eventually flushes one cannot adopt it. Compare this across a
 * batch's flight to tell an outside writer from the batch itself.
 * Compare `captureProjectRevision` instead whenever the question really is
 * whether the project still matches a planned base state.
 */
export function captureUnownedProjectMutations(): number {
    return automergeRepository.getUnownedMutationEpoch();
}
