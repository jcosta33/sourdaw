import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { type Track } from '#/modules/Arrangement/models/Track';

/** Get the raw track store state snapshot. */
export function getTrackStoreState(): { tracks: Track[]; selectedTrackId: string | null } | null {
    return trackStore.value;
}

/** Alias for getTrackStoreState — used by services. */
export const getTrackState = getTrackStoreState;

/** Set the track store state (for undo/redo handlers). */
export function setTrackStoreState(state: NonNullable<typeof trackStore.value>): void {
    trackStore.set(state);
}
