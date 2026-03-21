/**
 * Command Queries — use case layer exposing Command state
 * to cross-module consumers.
 */

import { type UndoEntry, generateGroupId as modelGenerateGroupId } from '../models/UndoEntry';
import { type AppAction, type AppActionType } from '../models/AppAction';

export type { UndoEntry, AppAction, AppActionType };
export { modelGenerateGroupId as generateGroupId };
