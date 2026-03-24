/**
 * Command Queries — use case layer exposing Command state
 * to cross-module consumers.
 */

import { type UndoEntry, generateGroupId as modelGenerateGroupId } from '../models/UndoEntry';
import { type AppAction, type AppActionType } from '../models/AppAction';
import { type ActionHandler } from '../models/ActionHandler';

export type { UndoEntry, AppAction, AppActionType, ActionHandler };
export { modelGenerateGroupId as generateGroupId };
