import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function setVcaGain(vcaGroupId: string, gain: number): void {
    setVcaGroupsState(
        getVcaGroupsState().map((gain1) => (gain1.id === vcaGroupId ? { ...gain1, gain: Math.max(0, Math.min(2, gain)) } : gain1))
    );
}
