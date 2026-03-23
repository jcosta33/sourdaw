import { trackStore } from '#/modules/Track/stores/trackStore';
import { type Track } from '#/modules/Track/models/Track';

/** Get the raw track store state snapshot. */
export function getTrackStoreState(): { tracks: Track[]; selectedTrackId: string | null } | null {
    return trackStore.value;
}

/** Set the track store state (for undo/redo handlers). */
export function setTrackStoreState(state: NonNullable<typeof trackStore.value>): void {
    trackStore.set(state);
}
