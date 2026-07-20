import { getVcaGroupsState, setVcaGroupsState } from '../../stores/vcaGroupStore';

export function setVcaGain(vcaGroupId: string, gain: number): boolean {
    const clampedGain = Math.max(0, Math.min(2, gain));
    const groups = getVcaGroupsState();
    const updatedGroups = groups.map((group) => {
        if (group.id !== vcaGroupId || Object.is(group.gain, clampedGain)) {
            return group;
        }

        return { ...group, gain: clampedGain };
    });
    const changed = updatedGroups.some((group, index) => group !== groups[index]);
    if (!changed) {
        return false;
    }

    setVcaGroupsState(updatedGroups);
    return true;
}
