import { createVCAGroup } from '../vcaFader/createVCAGroup';
import { assignTrackToVCA } from '../vcaFader/assignTrackToVCA';
import { getAllVCAGroups } from '../vcaFader/getAllVCAGroups';

/**
 * Create a new VCA group named `VCA <n>` where `<n>` is the next sequential number,
 * and immediately assign the given track to it.
 */
export function createAndAssignVcaGroup(trackId: string): void {
    const group = createVCAGroup(`VCA ${String(getAllVCAGroups().length + 1)}`);
    assignTrackToVCA(trackId, group.id);
}
