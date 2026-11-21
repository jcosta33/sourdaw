import { reserveNextTrackColor } from '../../models/Track';

type FolderCreationIdentity = { color: string; initialAlternativeId: string };

// The folder payload has no field for these, so they are pinned per action object: the creator
// executes with them and the batch planner reads them.
const pinnedIdentities = new WeakMap<object, FolderCreationIdentity>();

export function readFolderCreationIdentity(action: object): FolderCreationIdentity {
    const pinned = pinnedIdentities.get(action);
    if (pinned) {
        return pinned;
    }
    const identity = { color: reserveNextTrackColor(), initialAlternativeId: `alt-${crypto.randomUUID()}` };
    pinnedIdentities.set(action, identity);
    return identity;
}
