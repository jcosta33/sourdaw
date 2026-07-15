import { branchStore, validateStoredBranchStoreState } from '../stores/branchStore';

export function replaceBranchState(state: unknown): void {
    branchStore.set(validateStoredBranchStoreState(state));
}
