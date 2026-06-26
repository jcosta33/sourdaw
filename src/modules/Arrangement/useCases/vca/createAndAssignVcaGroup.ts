import { createVcaGroup } from './createVcaGroup';
import { getVcaGroups } from './getVcaGroups';

/**
 * Create a new VCA group named `VCA <n>` where `<n>` is the next sequential number,
 * and immediately assign the given track to it.
 */
export function createAndAssignVcaGroup(trackId: string): void {
    createVcaGroup(`VCA ${String(getVcaGroups().length + 1)}`, [trackId]);
}
