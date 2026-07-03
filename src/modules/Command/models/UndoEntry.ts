// Canonical UndoEntry types and factories live in their defining use-case files.
// This module remains a compatibility surface for existing Command internals;
// this task only split the helper functions out of `commandQueries`.
export { createUndoEntry } from '../useCases/commandQueries';
export { createCallbackUndoEntry } from '../useCases/createCallbackUndoEntry';

export type { UndoSource, ActionUndoEntry, CallbackUndoEntry, UndoEntry } from '../useCases/commandQueries';
