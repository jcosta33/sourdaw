import { transportStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { activeRecordingRef, type RecordingMidiAdmission } from '../../stores/activeRecordingRef';

import { recordingMidiSourceBeatAt } from './recordingMidiSourceBeatAt';
import { recordingPassIndex } from './recordingPassIndex';
import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

type EventPosition = { beat: number; passIndex: number };

export function admitRecordingMidiNoteOn(input: {
    trackId: string;
    channel: number;
    note: number;
    velocity: number;
    audioTime: number;
    position: EventPosition;
    initialExpression?: RecordingMidiAdmission['initialExpression'];
}): RecordingMidiAdmission | null {
    if (transportStore.value?.isRecording !== true || !takeOwnsRecordingRoot()) {
        return null;
    }
    const track = getTrackState()?.tracks.find((candidate) => candidate.id === input.trackId && candidate.armed);
    const clip = track?.clips.find(
        (candidate) => candidate.type === 'midi' && activeRecordingRef.current.includes(candidate.id)
    );
    if (!clip || !Number.isFinite(input.audioTime)) {
        return null;
    }
    const onsetSourceBeat = recordingMidiSourceBeatAt(clip.id, input.position);
    if (onsetSourceBeat === null) {
        return null;
    }
    const onsetPassIndex = recordingPassIndex(input.position);
    if (onsetPassIndex === null) {
        return null;
    }
    const admitted: RecordingMidiAdmission = {
        id: crypto.randomUUID(),
        clipId: clip.id,
        trackId: input.trackId,
        channel: input.channel,
        note: input.note,
        velocity: input.velocity,
        onsetAudioTime: input.audioTime,
        onsetSourceBeat,
        onsetPassIndex,
    };
    if (input.initialExpression) {
        admitted.initialExpression = Object.assign({}, input.initialExpression);
    }
    activeRecordingRef.midiAdmissions.push(admitted);
    return admitted;
}
