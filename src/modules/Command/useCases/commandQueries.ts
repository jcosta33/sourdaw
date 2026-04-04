/**
 * Command Queries — use case layer exposing Command state
 * to cross-module consumers.
 */

import {
    type UndoEntry,
    type UndoSource,
    type ActionUndoEntry,
    type CallbackUndoEntry,
    generateGroupId as modelGenerateGroupId,
    createUndoEntry,
    createCallbackUndoEntry,
    isActionEntry,
} from '../models/UndoEntry';
import { type AppAction, type AppActionType } from '../models/AppAction';
import { type ActionHandler } from '../models/ActionHandler';

export type { UndoEntry, UndoSource, ActionUndoEntry, CallbackUndoEntry, AppAction, AppActionType, ActionHandler };
export { modelGenerateGroupId as generateGroupId, createUndoEntry, createCallbackUndoEntry, isActionEntry };
