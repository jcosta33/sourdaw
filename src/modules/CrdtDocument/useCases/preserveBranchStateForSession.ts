import { branchSessionBackupStorage } from '../stores/branchSessionBackupStorage';
import { branchStore } from '../stores/branchStore';

export function preserveBranchStateForSession(): void {
    if (branchSessionBackupStorage.get() !== null) {
        return;
    }

    const state = branchStore.value;
    if (state === null) {
        return;
    }

    branchSessionBackupStorage.set(structuredClone(state));
}
