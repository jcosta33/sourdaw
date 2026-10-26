import { transportStore } from '#/modules/Transport/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { activeRecordingRef, type RecordingMidiAdmission } from '../../stores/activeRecordingRef';

import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

type EventPosition = { beat: number; passIndex: number };

/** One admitted event's unwrapped position in the clip opened by this recording. */
function sourceBeat(clipStartBeat: number, position: EventPosition): number | null {
    const pass = position.passIndex - activeRecordingRef.startWrapCount;
    if (!Number.isFinite(position.beat) || !Number.isSafeInteger(pass) || pass < 0) {
        return null;
    }
    if (pass === 0) {
        return Math.max(0, position.beat - clipStartBeat);
    }
    const loopLength = activeRecordingRef.loopEnd - activeRecordingRef.loopStart;
    if (!activeRecordingRef.startedLooping || loopLength <= 0) {
        return null;
    }
    return (
        Math.max(0, activeRecordingRef.loopEnd - clipStartBeat) +
        (pass - 1) * loopLength +
        Math.max(0, position.beat - activeRecordingRef.loopStart)
    );
}

/** Accept a physical or virtual onset before its live-audio handler can queue or await. */
export function admitRecordingMidiNoteOn(input: {
    trackId: string;
    channel: number;
    note: number;
    velocity: number;
    audioTime: number;
    position: EventPosition;
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
    const onsetSourceBeat = sourceBeat(clip.startBeat, input.position);
    if (onsetSourceBeat === null) {
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
    };
    activeRecordingRef.midiAdmissions.push(admitted);
    return admitted;
}

/** Accept key-up at arrival; a queued key-up still closes its own onset. */
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

export function findOpenRecordingMidiAdmission(channel: number, note: number): RecordingMidiAdmission | undefined {
    if (!takeOwnsRecordingRoot()) {
        return undefined;
    }
    return activeRecordingRef.midiAdmissions.findLast(
        (candidate) =>
            candidate.channel === channel && candidate.note === note && candidate.releaseAudioTime === undefined
    );
}

/** A completed note was written live; Stop must not add it again. */
export function retireRecordingMidiAdmission(id: string): void {
    if (!takeOwnsRecordingRoot()) {
        return;
    }
    activeRecordingRef.midiAdmissions = activeRecordingRef.midiAdmissions.filter((candidate) => candidate.id !== id);
}

export function getRecordingMidiAdmission(id: string): RecordingMidiAdmission | undefined {
    if (!takeOwnsRecordingRoot()) {
        return undefined;
    }
    return activeRecordingRef.midiAdmissions.find((candidate) => candidate.id === id);
}
