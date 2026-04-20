import { pushUndoEntry } from '#/modules/Command/useCases';

export const deleteSelectedPointsDependencies = {
    pushUndoEntry,
} as const;
