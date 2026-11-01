import { activeRecordingRef, type RecordingMidiAdmission } from '../../stores/activeRecordingRef';

import { recordingMidiSourceBeatAt } from './recordingMidiSourceBeatAt';
import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

type EventPosition = { beat: number; passIndex: number };

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
    const change: NonNullable<RecordingMidiAdmission['expressionChanges']>[number] = {
        dimension: input.dimension,
        value: input.value,
        audioTime: input.audioTime,
        sourceBeat: sourcePosition,
    };
    if (input.bendRangeSemitones !== undefined) {
        change.bendRangeSemitones = input.bendRangeSemitones;
    }
    changes.push(change);
    if (changes.length > 4096) {
        changes.splice(1, 1);
    }
    admitted.expressionChanges = changes;
}
