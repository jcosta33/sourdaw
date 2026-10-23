import { markDirty } from '../saveProject/markDirty';

import { unsavedClosedTakes } from './unsavedClosedTakes';

/**
 * Re-evaluate the dirty state of a project that a replacement left in place.
 *
 * `markDirty` ignores every write while `loading` is set, so a take that the
 * replacement's own stop commits into the outgoing project never marks it.
 * When the replacement aborts and hands `loading` back, that project is still
 * the open one: if a take has settled past what it is saved through, it holds
 * work no save has kept, and autosave and the close prompt must see it. A
 * replacement that completes never calls this, because the incoming project
 * owes nothing for the outgoing one's takes.
 *
 * Call it after the transient flags are restored: if they restore `loading: true`
 * the guard in `markDirty` still holds and the next replacement decides.
 */
export function markOutgoingProjectDirtyAfterAbort(): void {
    if (unsavedClosedTakes.hasUnsaved()) {
        markDirty();
    }
}
