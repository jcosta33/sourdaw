// Canonical UndoEntry / undo-entry factories live in `../useCases/commandQueries`.
// This module previously held a *second* implementation that minted ids with a
// full `crypto.randomUUID()` while `commandQueries` used `.slice(0, 8)`; the two
// were live on different call graphs, so undo-entry ids were formatted
// inconsistently depending on which path created the entry. To collapse to a
// single source of truth without churning out-of-module importers, this file now
// re-exports the canonical entry factories still consumed via this path
// (`Command/stores/*`). New code should import from `commandQueries` (or the
// `useCases` barrel) directly.
export { createUndoEntry, createCallbackUndoEntry } from '../useCases/commandQueries';

export type { UndoSource, ActionUndoEntry, CallbackUndoEntry, UndoEntry } from '../useCases/commandQueries';
