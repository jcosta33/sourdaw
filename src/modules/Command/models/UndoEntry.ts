// Canonical UndoEntry / undo-entry factories live in `../useCases/commandQueries`.
// This module previously held a *second* implementation that minted ids with a
// full `crypto.randomUUID()` while `commandQueries` used `.slice(0, 8)`; the two
// were live on different call graphs, so undo-entry ids were formatted
// inconsistently depending on which path created the entry. To collapse to a
// single source of truth without churning out-of-module importers, this file now
// re-exports the canonical definitions. New code should import from
// `commandQueries` (or the `useCases` barrel) directly; the remaining importers
// of this path (Command/stores/*) are repointed in a follow-up.
export { createUndoEntry, createCallbackUndoEntry, generateGroupId, isActionEntry } from '../useCases/commandQueries';

export type { UndoSource, ActionUndoEntry, CallbackUndoEntry, UndoEntry } from '../useCases/commandQueries';
