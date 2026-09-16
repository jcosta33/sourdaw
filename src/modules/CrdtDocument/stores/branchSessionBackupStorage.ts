import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

const BRANCH_SESSION_BACKUP_STORAGE_KEY = 'sourdaw-branch-session-backup';

export const branchSessionBackupStorage = createLocalStorage<unknown>(BRANCH_SESSION_BACKUP_STORAGE_KEY);

export function readDurableBranchSessionBackup(): unknown {
    return createLocalStorage<unknown>(BRANCH_SESSION_BACKUP_STORAGE_KEY).get();
}
