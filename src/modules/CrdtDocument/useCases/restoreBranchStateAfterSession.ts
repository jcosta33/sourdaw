import { restoreBranchStateFromSessionBackup } from '../stores/branchStore';

export function restoreBranchStateAfterSession(): void {
    restoreBranchStateFromSessionBackup();
}
