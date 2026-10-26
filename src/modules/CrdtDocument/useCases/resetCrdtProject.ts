import { logger } from '#/infra/logger/appLogger';

import { DEFAULT_CRDT_ROOT_LINEAGE } from '../models/CrdtRootLineage';
import {
    branchStateAuthority,
    type BranchResetFinalizeOutcome,
    type BranchResetHandle,
} from '../repositories/branchStateAuthority';
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

/**
 * `transport-active` is the one refusal that asks the caller to act: Record or
 * Play landed while the reset's durable steps were awaited, so the outgoing
 * project is still rolling. The caller stops the transport and asks again;
 * nothing was replaced and the durable record of the attempt is withdrawn.
 */
export type CrdtProjectResetResult =
    | { status: 'replaced'; finalize: () => Promise<BranchResetFinalizeOutcome> }
    | { status: 'refused'; reason: CrdtProjectResetRefusal }
    | { status: 'transport-active' };

/**
 * A marker that cannot be withdrawn stays durable, and that is tolerable only
 * because the authority marks the handle withdrawn: the durable authority still
 * names the outgoing project, so the next reset of this instance settles it and
 * a boot rolls it back, while branch hydrations in between keep the live list
 * rather than the replacement's. The retry the caller makes is that next reset.
 */
async function withdrawBegunReset(handle: BranchResetHandle): Promise<void> {
    const outcome = await branchStateAuthority.abortReset(handle);
    if (outcome !== 'aborted' && outcome !== 'superseded') {
        logger.warn(`[resetCrdtProject] Could not withdraw the recorded reset (${outcome}); the retry settles it.`);
    }
}

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
 * @param isTransportIdle Read synchronously, after the last `await` and in the
 * same turn as the switch. A caller that can have a transport rolling passes
 * the Transport module's `isTransportIdle`; it is a parameter, not an import,
 * because Transport already reaches CrdtDocument and importing it back closes
 * a dependency cycle. Omitted, nothing is checked, which is right only where no
 * transport exists yet, such as the bootstrap.
 */
export async function resetCrdtProject(
    name: string,
    onAuthorityReplaced?: () => void,
    isTransportIdle?: () => boolean
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

    // The durable steps above are awaited, so a Play or Record pressed during
    // them is already rolling the outgoing project. Nothing below awaits before
    // the switch, which makes this check hold at the switch: the transport store
    // alone would read stopped after the reset while the scheduler and engine
    // kept playing the old project.
    if (isTransportIdle !== undefined && !isTransportIdle()) {
        await withdrawBegunReset(begun.handle);
        return { status: 'transport-active' };
    }

    resetCrdtProjectAuthority(name, onAuthorityReplaced, { epoch, old, branchState });

    return {
        status: 'replaced',
        finalize: () => branchStateAuthority.finalizeReset(begun.handle, committedPersistenceAuthority()),
    };
}
