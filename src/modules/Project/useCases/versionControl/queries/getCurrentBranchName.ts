import { versionControlStore } from '../../../stores/versionControlStore';

export function getCurrentBranchName(): string {
    const state = versionControlStore.value;
    if (!state) {
        return 'main';
    }
    return state.branches.find((b) => b.id === state.currentBranchId)?.name ?? 'main';
}