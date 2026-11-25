import { activeRecordingRef, isFrozenTrackRefusingRecording } from '#/modules/Arrangement/stores';

import { recordingMidiAdmissionPort } from './recordingMidiAdmissionPort';
import { type RecordingPlacementDependencies } from './recordingPlacementDependencies';

type TrackClips = { clips: readonly { id: string }[] };

/** Whether the recorder opened a take clip on this track that has not been committed yet. */
function hasOpenTake(track: TrackClips): boolean {
    return activeRecordingRef.current.some((openId) => track.clips.some((clip) => clip.id === openId));
}

/**
 * Whether live input on this track is being written into a take right now. A
 * frozen track never starts a take, but a take opened before the freeze
 * finishes normally.
 */
export function isRecordingOnArmedTrack(deps: RecordingPlacementDependencies, trackId: string): boolean {
    const track = deps.getTrackStoreState()?.tracks.find((candidate) => candidate.id === trackId);
    if (!track?.armed) {
        return false;
    }
    if (isFrozenTrackRefusingRecording(track) && !hasOpenTake(track)) {
        return false;
    }
    return (deps.getTransportStoreValue()?.isRecording ?? false) && recordingMidiAdmissionPort.takeOwnsRecordingRoot();
}
