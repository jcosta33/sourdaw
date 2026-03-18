/**
 * Command Queries — use case layer exposing Command state
 * to cross-module consumers.
 */

import { undoStore } from '../stores/undoStore';
import { type UndoEntry, generateGroupId as modelGenerateGroupId } from '../models/UndoEntry';
import { type AppAction, type AppActionType } from '../models/AppAction';

export type { UndoEntry, AppAction, AppActionType };
export { modelGenerateGroupId as generateGroupId };

/** Get the undo store snapshot. */
export function getUndoStoreValue(): typeof undoStore.value {
    return undoStore.value;
}
