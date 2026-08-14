import { logger } from '#/infra/logger/appLogger';
import {
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { automergeRepository } from '../repositories/automergeRepository';
import { agentProjectRepairStateStore } from '../stores/agentProjectRepairStateStore';
import { branchStore, MAIN_BRANCH_ID } from '../stores/branchStore';

import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';
import { runCrdtPersistenceOperation } from './runCrdtPersistenceOperation';

/**
 * @param onAuthorityReplaced Called once the previous project is unrecoverable,
 * before any of the follow-up work that can still throw. A caller that aborts
 * on a throw needs to know which side of that line it landed on: before it, the
 * previous session is intact and can be restored; after it, there is nothing
 * left to restore and pretending otherwise hides the loss.
 *
 * Positional rather than the house object-param shape on purpose — 4 production
 * call sites and 25 spec files pass `name` alone, and none of them should have
 * to change to learn a fact only one caller needs.
 */
export function resetCrdtProjectAuthority(name: string, onAuthorityReplaced?: () => void): void {
    // Drain writes owned by the outgoing repository before replacing its root.
    // The branch update below must then be the first store write observed by
    // the new authority.
    flushAutomergeStorageWrites();
    void runCrdtPersistenceOperation('reset');
    try {
        automergeRepository.createProject(name);
    } catch (error) {
        // `createProject` is not atomic — it clears the document map before it
        // installs the new root. A throw partway leaves the repository emptied,
        // which is past the point of no return even though it did not finish, so
        // the caller must not be told this was recoverable: it would restore the
        // flags and restart autosave into `compactProject()` against an empty
        // document set.
        onAuthorityReplaced?.();
        throw error;
    }
    // Audit CC-2 — the outgoing project's projected caches must not survive the
    // authority switch. Left in place they are the stale-bleed source: the
    // first projection against the fresh document would carry the previous
    // project's tracks/automation/markers into it.
    resetAutomergeStorageProjections(DOC_PREFIX_ROOT);
    agentProjectRepairStateStore.set(null);
    // The point of no return, reported only once everything it asserts is
    // actually true: the previous root is gone from the repository *and* every
    // root-doc projection has been reset to its default, so the previous
    // project is out of the stores. A caller that aborts on a later throw can
    // rely on both. `resetAutomergeStorageProjections` guards each projection
    // individually, so it cannot leave that half-done and cannot throw past
    // this line.
    onAuthorityReplaced?.();
    // Deferred past `createProject` deliberately. This clears the inverse-action
    // map undo replays from, and that map describes the document being replaced
    // — so it must go when the document does, and not a moment earlier. Run at
    // the top (where it used to be), every abort before `createProject` left the
    // user's undo entries still rendered and silently inert.
    resetActionReplayAuthority();
    // `branchStore` is localStorage-backed, and that adapter deliberately
    // propagates a failed write so callers can retry (see `createLocalStorage`).
    // This caller cannot: it is the last statement of the authority switch, and
    // the switch is already irreversible by the time it runs. Letting a full
    // origin quota throw from here would abort a project load back into a
    // session that no longer exists. The branch record is rebuilt by the next
    // reset or load, so a failure to persist it is degraded, not fatal.
    try {
        branchStore.set({
            branches: [
                {
                    branchId: MAIN_BRANCH_ID,
                    name: 'Main',
                    rootDocId: DOC_PREFIX_ROOT,
                    sourceBranchId: null,
                    createdAt: Date.now(),
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: MAIN_BRANCH_ID,
        });
    } catch (error) {
        logger.error(new Error('[resetCrdtProjectAuthority] Failed to publish the new branch state', { cause: error }));
    }
}
