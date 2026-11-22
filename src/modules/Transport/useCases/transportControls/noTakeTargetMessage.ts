import { getTrackEligibility, isFrozenTrackRefusingRecording } from '#/modules/Arrangement/stores';
import { getTrackStoreState } from '#/modules/Arrangement/useCases';

/** What Record says when no take can start: a frozen armed track is named, so the user knows to unfreeze it. */
export function noTakeTargetMessage(): string {
    const hasFrozenArmedTrack = (getTrackStoreState()?.tracks ?? []).some(
        (track) =>
            track.armed && getTrackEligibility(track.kind).acceptsRecording && isFrozenTrackRefusingRecording(track)
    );
    if (hasFrozenArmedTrack) {
        return 'Unfreeze the track to record on it.';
    }
    return 'No track is armed for recording. Arm a track, then press Record.';
}
