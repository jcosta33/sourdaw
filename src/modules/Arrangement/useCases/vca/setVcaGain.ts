import { getVcaGroupsState, setVcaGroupsState } from '#/modules/Arrangement/stores/vcaGroupStore';

export function setVcaGain(vcaGroupId: string, gain: number): void {
    setVcaGroupsState(
        getVcaGroupsState().map((g) => (g.id === vcaGroupId ? { ...g, gain: Math.max(0, Math.min(2, gain)) } : g))
    );
}
