import { type FreezeSources, readFreezeSources } from './freezeSourceTracks';
import { freezeSourceTracksMatch } from './freezeSourceTracksMatch';

/**
 * Reads the live sources of a frozen track and remembers them as the ones last seen. Returns them
 * when they differ from the ones remembered before, and null when they are the same or this is the
 * first sighting (a freshly loaded or freshly frozen track has nothing earlier to differ from).
 * Reading and comparing is synchronous and hashes nothing, so it is cheap enough for every write
 * to a store the sources come from.
 */
export function takeChangedFreezeSources(seen: Map<string, FreezeSources>, trackId: string): FreezeSources | null {
    const sources = readFreezeSources(trackId);
    const previous = seen.get(trackId);
    seen.set(trackId, sources);
    if (previous === undefined || freezeSourceTracksMatch(previous, sources)) {
        return null;
    }
    return sources;
}
