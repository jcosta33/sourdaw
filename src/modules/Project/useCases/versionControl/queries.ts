import { versionControlStore } from '../../stores/versionControlStore';
import { type VersionControlState } from '../../models/ProjectVersion';

export function getVersionHistory(): VersionControlState | null {
    return versionControlStore.value;
}

export function getVersionCount(): number {
    return versionControlStore.value?.versions.length ?? 0;
}

export function getBranchCount(): number {
    return versionControlStore.value?.branches.length ?? 0;
}

export function getCurrentBranchName(): string {
    const state = versionControlStore.value;
    if (!state) {
        return 'main';
    }
    return state.branches.find((b) => b.id === state.currentBranchId)?.name ?? 'main';
}

export function setAutoSaveInterval(minutes: number): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }
    versionControlStore.set({ ...state, autoSaveInterval: minutes });
}
