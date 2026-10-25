import { type BranchStoreState } from '../../stores/branchStore';
import { type BranchResetRecord } from '../branchStateEnvelopeStorage';
import { type CrdtPersistenceAuthority } from '../crdtPersistence/persistenceAuthorityModel';

import { isSameResetSide } from './isSameResetSide';

/**
 * Which side of the replacement the durable persistence authority proves.
 *
 * `null` when it proves neither, so no branch list this marker carries
 * describes the durable project and only a later boot can settle the reset.
 */
export function getResetSettlement(
    reset: BranchResetRecord,
    durable: CrdtPersistenceAuthority
): { current: BranchStoreState; outcome: 'reset-rolled-back' | 'reset-finalized' } | null {
    if (isSameResetSide(durable, reset.old)) {
        return { current: reset.previous, outcome: 'reset-rolled-back' };
    }
    if (isSameResetSide(durable, reset.target)) {
        return { current: reset.intended, outcome: 'reset-finalized' };
    }
    return null;
}
