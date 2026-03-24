import { getVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';
import { type VcaGroup } from '#/modules/Arrangement/stores/vcaGroupStore';

export function getVcaGroups(): VcaGroup[] {
    return [...getVcaGroupsState()];
}
