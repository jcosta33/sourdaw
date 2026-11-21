import { getTrackEligibility, isFrozenTrackRefusingRecording } from '#/modules/Arrangement/stores';
import { getTrackStoreState } from '#/modules/Arrangement/useCases';

/**
 * Whether `startRecording` would open a take clip anywhere: an armed track whose
 * kind records and that is not frozen, since a frozen track plays only its buffer.
 */
export function hasArmedTakeTarget(): boolean {
    const tracks = getTrackStoreState()?.tracks ?? [];
    return tracks.some(
        (track) =>
            track.armed && getTrackEligibility(track.kind).acceptsRecording && !isFrozenTrackRefusingRecording(track)
    );
}
