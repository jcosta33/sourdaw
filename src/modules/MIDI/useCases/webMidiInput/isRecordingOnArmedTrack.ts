import { type RecordingPlacementDependencies } from './recordingPlacementDependencies';

/** Whether live input on this track is being written into a take right now. */
export function isRecordingOnArmedTrack(deps: RecordingPlacementDependencies, trackId: string): boolean {
    const track = deps.getTrackStoreState()?.tracks.find((candidate) => candidate.id === trackId);
    return (deps.getTransportStoreValue()?.isRecording ?? false) && (track?.armed ?? false);
}
