import {
    flushAutomergeStorageWrites,
    resetAutomergeStorageProjections,
} from '#/infra/store/storage/createAutomergeStorage';
import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { automergeRepository } from '../repositories/automergeRepository';
import { type CrdtPersistenceAuthority } from '../repositories/crdtPersistence/persistenceAuthorityModel';
import { agentProjectRepairStateStore } from '../stores/agentProjectRepairStateStore';
import { branchStore, createDefaultBranchStoreState, type BranchStoreState } from '../stores/branchStore';

import { beginPersistenceReplacement } from './beginPersistenceReplacement';
import { DOC_PREFIX_ROOT } from './crdtDocumentTypes';

/**
 * The replacement a durable reset has already recorded.
 *
 * `epoch` and `old` must be the pair the durable marker carries, so the first
 * full save of the new project compare-and-swaps on exactly the authority the
 * marker says it left. `branchState` is the list the marker promises to publish
 * — passed in rather than built here because the default list carries a
 * creation timestamp, and a second call to the factory would project a list no
 * durable record describes.
 */
export type CrdtProjectReplacement = {
    epoch: string;
    old: CrdtPersistenceAuthority;
    branchState: BranchStoreState;
};

/**
 * Swap the CRDT authority to a fresh project, synchronously and irreversibly.
 *
 * This is the switch itself, not the durable contract around it: nothing here
 * awaits, so every reader after it already sees the new project. A caller that
 * needs the replacement to survive a crash goes through `resetCrdtProject`,
 * which records the reset durably first and passes the `replacement` it
 * recorded. Without one, the queue reads its own authority lazily on first save
 * and the branch list is published to memory only.
 *
 * @param onAuthorityReplaced Called once the previous project is unrecoverable,
 * before any of the follow-up work that can still throw. A caller that aborts
 * on a throw needs to know which side of that line it landed on: before it, the
 * previous session is intact and can be restored; after it, there is nothing
 * left to restore and pretending otherwise hides the loss.
 *
 * Positional rather than the house object-param shape on purpose — the spec
 * bootstraps across the repository pass `name` alone, and none of them should
 * have to change to learn a fact only the durable path needs.
 */
export function resetCrdtProjectAuthority(
    name: string,
    onAuthorityReplaced?: () => void,
    replacement?: CrdtProjectReplacement
): void {
    // Drain writes owned by the outgoing repository before replacing its root.
    // The branch update below must then be the first store write observed by
    // the new authority.
    flushAutomergeStorageWrites();
    beginPersistenceReplacement({
        epoch: replacement?.epoch ?? crypto.randomUUID(),
        old: replacement?.old ?? null,
    });
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
    // The memory projection is the last statement of the authority switch:
    // every reader after it must already see the replacement's branch list.
    branchStore.set(replacement?.branchState ?? createDefaultBranchStoreState());
}
