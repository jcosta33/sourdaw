import { getVcaGroupsState } from '#/modules/Track/stores/vcaGroupStore';
import { type VcaGroup } from '#/modules/Track/stores/vcaGroupStore';

export function getVcaGroups(): VcaGroup[] {
    return [...getVcaGroupsState()];
}
