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

/** Same owner clock for a Stop boundary as for every admitted event. */
export function recordingMidiSourceBeatAt(clipId: string, position: EventPosition): number | null {
    if (!takeOwnsRecordingRoot() || !activeRecordingRef.current.includes(clipId)) {
        return null;
    }
    const clip = getTrackState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
    return clip ? sourceBeat(clip.startBeat, position) : null;
}

/** Accept a physical or virtual onset before its live-audio handler can queue or await. */
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
    const admitted: RecordingMidiAdmission = {
        id: crypto.randomUUID(),
        clipId: clip.id,
        trackId: input.trackId,
        channel: input.channel,
        note: input.note,
        velocity: input.velocity,
        onsetAudioTime: input.audioTime,
        onsetSourceBeat,
        ...(input.initialExpression ? { initialExpression: { ...input.initialExpression } } : {}),
    };
    activeRecordingRef.midiAdmissions.push(admitted);
    return admitted;
}

/** Keep a member-channel gesture on the admitted onset even while its live route waits. */
export function admitRecordingMidiExpression(input: {
    channel: number;
    dimension: 'pressure' | 'slide' | 'pitchBend';
    value: number;
    audioTime: number;
    bendRangeSemitones?: number;
    position: EventPosition;
}): void {
    const admitted = activeRecordingRef.midiAdmissions.findLast(
        (candidate) => candidate.channel === input.channel && candidate.releaseAudioTime === undefined
    );
    if (!admitted || !takeOwnsRecordingRoot() || input.audioTime < admitted.onsetAudioTime) {
        return;
    }
    const sourcePosition = recordingMidiSourceBeatAt(admitted.clipId, input.position);
    if (sourcePosition === null) {
        return;
    }
    const changes = admitted.expressionChanges ?? [];
    changes.push({
        dimension: input.dimension,
        value: input.value,
        audioTime: input.audioTime,
        sourceBeat: sourcePosition,
        ...(input.bendRangeSemitones === undefined ? {} : { bendRangeSemitones: input.bendRangeSemitones }),
    });
    if (changes.length > 4096) {
        changes.splice(1, 1);
    }
    admitted.expressionChanges = changes;
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

export function findOpenRecordingMidiMemberAdmission(channel: number): RecordingMidiAdmission | undefined {
    if (!takeOwnsRecordingRoot()) {
        return undefined;
    }
    return activeRecordingRef.midiAdmissions.findLast(
        (candidate) => candidate.channel === channel && candidate.releaseAudioTime === undefined
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
