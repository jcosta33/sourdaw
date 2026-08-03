import { sanitizeVcaGroups, setVcaGroupsState } from '../../stores/vcaGroupStore';

/**
 * Load persisted VCA groups into the live store, replacing whatever the
 * previous project left there.
 *
 * Called unconditionally by the project-load path, including with `undefined`:
 * a file that carries no groups must clear the ones already in memory, or the
 * outgoing project's masters keep attenuating the incoming one's tracks.
 */
export function hydrateVcaGroups(persistedGroups: unknown): void {
    setVcaGroupsState(sanitizeVcaGroups(persistedGroups));
}
