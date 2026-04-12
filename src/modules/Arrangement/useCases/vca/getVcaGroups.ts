import { getVcaGroupsState, type VcaGroup } from '../../stores/vcaGroupStore';

export type { VcaGroup };

export function getVcaGroups(): VcaGroup[] {
    return [...getVcaGroupsState()];
}
