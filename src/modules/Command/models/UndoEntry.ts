// Canonical UndoEntry types and factories live in their defining use-case files.
// This module previously held a *second* implementation that minted ids with a
// full `crypto.randomUUID()` while `commandQueries` used `.slice(0, 8)`; the two
// were live on different call graphs, so undo-entry ids were formatted
// inconsistently depending on which path created the entry. To collapse to a
// single source of truth without churning out-of-module importers, this file now
// re-exports the canonical entry factories still consumed via this path.
// New code should import from the defining use-case file directly.
export { createUndoEntry } from '../useCases/commandQueries';
export { createCallbackUndoEntry } from '../useCases/createCallbackUndoEntry';

export type { UndoSource, ActionUndoEntry, CallbackUndoEntry, UndoEntry } from '../useCases/commandQueries';
