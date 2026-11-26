/**
 * What the document records as written to one list item, found by its `id`, since earlier heads.
 *
 * - `unknown`: the document no longer holds those heads (a rollback discarded them), so nothing can
 *   be said about what was written since.
 * - `absent`: there is no such document, or the item is missing at the heads or now.
 * - `reinserted`: the item is now a different document object than at the heads (a move writes the
 *   row whole), so its field writes cannot be told apart from the move.
 * - `present`: the same object; each path, relative to the item, names a key written since the heads
 *   (`['freezeState', 'status']` for a write inside a nested map).
 */
export type ListItemWritesSince =
    | { status: 'unknown' }
    | { status: 'absent' }
    | { status: 'reinserted' }
    | { status: 'present'; writtenPaths: ReadonlyArray<readonly string[]> };
