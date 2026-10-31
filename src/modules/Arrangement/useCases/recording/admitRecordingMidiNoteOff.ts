import { getTrackState } from '../../repositories/track/getTrackState';

import { findOpenRecordingMidiAdmission } from './findOpenRecordingMidiAdmission';
import { sourceBeat } from './sourceBeat';
import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

type EventPosition = { beat: number; passIndex: number };

export function admitRecordingMidiNoteOff(input: {
    channel: number;
    note: number;
    audioTime: number;
    position: EventPosition;
}): void {
    if (!takeOwnsRecordingRoot()) {
        return;
    }
    const admitted = findOpenRecordingMidiAdmission(input.channel, input.note);
    if (!admitted || input.audioTime < admitted.onsetAudioTime) {
        return;
    }
    const clip = getTrackState()
        ?.tracks.find((track) => track.id === admitted.trackId)
        ?.clips.find((candidate) => candidate.id === admitted.clipId);
    if (!clip) {
        return;
    }
    const releaseSourceBeat = sourceBeat(clip.startBeat, input.position);
    if (releaseSourceBeat === null) {
        return;
    }
    admitted.releaseAudioTime = input.audioTime;
    admitted.releaseSourceBeat = releaseSourceBeat;
}
