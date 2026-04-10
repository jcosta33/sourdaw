import { inject } from '#/infra/di/inject';
import { getVcaGroupsState, type VcaGroup } from '#/modules/Arrangement/stores/vcaGroupStore';

export type { VcaGroup };

export const getVcaGroups = inject({ getVcaGroupsState })(
    ({ getVcaGroupsState: getGroups }) =>
        function getVcaGroups(): VcaGroup[] {
            return [...getGroups()];
        }
);
