import { type BranchResetRecord } from '../branchStateEnvelopeStorage';
import { arePersistenceAuthoritiesEqual } from '../crdtPersistence/arePersistenceAuthoritiesEqual';

/**
 * Whether the marker still in the envelope is the one this boot classified.
 *
 * Owner, `old` and `target` together: an owner alone would let a restarted
 * instance's second reset be settled by the first one's durable reading.
 */
export function isSameResetRecord(fresh: BranchResetRecord | null, observed: BranchResetRecord): boolean {
    return (
        fresh !== null &&
        fresh.owner === observed.owner &&
        arePersistenceAuthoritiesEqual(fresh.old, observed.old) &&
        arePersistenceAuthoritiesEqual(fresh.target, observed.target)
    );
}
