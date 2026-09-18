import { logger } from '#/infra/logger/appLogger';

import { DEFAULT_CRDT_ROOT_LINEAGE } from '../models/CrdtRootLineage';
import { branchStateAuthority, type BranchResetFinalizeOutcome } from '../repositories/branchStateAuthority';
import { advancePersistenceAuthority } from '../repositories/crdtPersistence/advancePersistenceAuthority';
import { type CrdtPersistenceAuthority } from '../repositories/crdtPersistence/persistenceAuthorityModel';
import { createDefaultBranchStoreState } from '../stores/branchStore';

import { committedPersistenceAuthority } from './committedPersistenceAuthority';
import { readDurablePersistenceAuthority } from './readDurablePersistenceAuthority';
import { resetCrdtProjectAuthority } from './resetCrdtProjectAuthority';

/**
 * Why the outgoing project was left alone.
 *
 * Every reason is decided before the switch, so a refusal means nothing has
 * changed: the caller can abort back into the project the user still has.
 * `authority-unavailable` is storage refusing the durable read the replacement
 * has to compare-and-swap against.
 */
export type CrdtProjectResetRefusal =
    | 'session-active'
    | 'reset-active'
    | 'write-failed'
    | 'storage-unavailable'
    | 'lock-unavailable'
    | 'authority-unavailable';

export type CrdtProjectResetResult =
    | { status: 'replaced'; finalize: () => Promise<BranchResetFinalizeOutcome> }
    | { status: 'refused'; reason: CrdtProjectResetRefusal };

/**
 * Replace the active project durably.
 *
 * The reset is recorded before the outgoing root is destroyed, so a crash
 * anywhere after this call leaves the next boot a marker naming both
 * persistence authorities rather than a branch list belonging to a project that
 * no longer exists. `finalize` publishes the replacement's branch list and
 * clears the marker, and only a save that reached storage with the recorded
 * target authority can clear it — which is why the caller must not restart
 * autosave or durability work until `finalize` answers `'finalized'`.
 *
 * @param onAuthorityReplaced Called once the previous project is unrecoverable.
 * A caller that aborts on a throw from here needs to know which side of that
 * line it landed on; see `resetCrdtProjectAuthority`.
 */
export async function resetCrdtProject(
    name: string,
    onAuthorityReplaced?: () => void
): Promise<CrdtProjectResetResult> {
    let old: CrdtPersistenceAuthority;
    try {
        old = await readDurablePersistenceAuthority();
    } catch (error) {
        logger.error(
            new Error('[resetCrdtProject] Could not read the durable persistence authority', { cause: error })
        );
        return { status: 'refused', reason: 'authority-unavailable' };
    }

    const epoch = crypto.randomUUID();
    // The exact authority the replacement's first full save will commit: the
    // compare-and-swap claims `old`, so the record can name its result before
    // the save runs, and that is what makes a crash classifiable.
    const target = advancePersistenceAuthority(old, epoch, DEFAULT_CRDT_ROOT_LINEAGE);
    const branchState = createDefaultBranchStoreState();

    const begun = await branchStateAuthority.beginReset({ old, target, intended: branchState });
    if (begun.status === 'refused') {
        return { status: 'refused', reason: begun.reason };
    }

    resetCrdtProjectAuthority(name, onAuthorityReplaced, { epoch, old, branchState });

    return {
        status: 'replaced',
        finalize: () => branchStateAuthority.finalizeReset(begun.handle, committedPersistenceAuthority()),
    };
}
