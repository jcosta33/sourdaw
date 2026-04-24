import { pushUndoEntry } from '#/modules/Command/stores';

export const deleteSelectedPointsDependencies = {
    pushUndoEntry,
} as const;
