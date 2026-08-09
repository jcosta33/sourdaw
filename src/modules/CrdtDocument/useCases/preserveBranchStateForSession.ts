import { branchSessionBackupStorage } from '../stores/branchSessionBackupStorage';
import { branchStore, suspendSessionBackupInvalidation } from '../stores/branchStore';

export function preserveBranchStateForSession(): void {
    // From here until the session's restore, the backup is session-owned and a
    // durable branch write no longer means the user wrote a branch — the host's
    // projected list is a durable write too, and it is the one the backup
    // exists to protect against. Unconditional, and before the early return:
    // when a backup is already present it is a retained one from a failed
    // restore, which is precisely the case where the invalidation is armed.
    // See #1557.
    suspendSessionBackupInvalidation();

    if (branchSessionBackupStorage.get() !== null) {
        return;
    }

    const state = branchStore.value;
    if (state === null) {
        return;
    }

    branchSessionBackupStorage.set(structuredClone(state));
}
