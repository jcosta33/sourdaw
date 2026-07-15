import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

export const branchSessionBackupStorage = createLocalStorage<unknown>('sourdaw-branch-session-backup');
