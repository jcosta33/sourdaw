import { inject } from '#/infra/di/inject';
import { getVcaGroupsState, setVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';

export const setVcaGainDependencies = {
    getVcaGroupsState,
    setVcaGroupsState,
};

export const setVcaGain = inject(setVcaGainDependencies)(
    ({ getVcaGroupsState: getGroups, setVcaGroupsState: setGroups }) =>
        function setVcaGain(vcaGroupId: string, gain: number): void {
            setGroups(
                getGroups().map((g) =>
                    g.id === vcaGroupId ? { ...g, gain: Math.max(0, Math.min(2, gain)) } : g
                )
            );
        }
);
