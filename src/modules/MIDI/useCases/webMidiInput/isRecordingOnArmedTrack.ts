import { isFrozenTrackRefusingRecording } from '#/modules/Arrangement/stores';

import { recordingMidiAdmissionPort } from './recordingMidiAdmissionPort';
import { type RecordingPlacementDependencies } from './recordingPlacementDependencies';

/** Whether live input on this track is being written into a take right now. A frozen track is never a take target. */
export function isRecordingOnArmedTrack(deps: RecordingPlacementDependencies, trackId: string): boolean {
    const track = deps.getTrackStoreState()?.tracks.find((candidate) => candidate.id === trackId);
    if (!track?.armed || isFrozenTrackRefusingRecording(track)) {
        return false;
    }
    return (deps.getTransportStoreValue()?.isRecording ?? false) && recordingMidiAdmissionPort.takeOwnsRecordingRoot();
}
