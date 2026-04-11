import { getVcaGroupsState, type VcaGroup } from '#/modules/Arrangement/stores/vcaGroupStore';

export type { VcaGroup };

export function getVcaGroups(): VcaGroup[] {
    return [...getVcaGroupsState()];
}
