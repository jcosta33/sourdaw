import { versionControlStore } from '../../../stores/versionControlStore';

export function getBranchCount(): number {
    return versionControlStore.value?.branches.length ?? 0;
}