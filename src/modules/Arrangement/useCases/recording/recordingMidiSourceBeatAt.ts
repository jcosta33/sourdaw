import { getTrackState } from '../../repositories/track/getTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { recordingCommitGroups } from './recordingCommitGroup';
import { sourceBeat } from './sourceBeat';
import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

type EventPosition = { beat: number; passIndex: number };

export function recordingMidiSourceBeatAt(clipId: string, position: EventPosition): number | null {
    if (
        !takeOwnsRecordingRoot() ||
        !recordingCommitGroups.reconcileAdmission(clipId) ||
        !activeRecordingRef.current.includes(clipId)
    ) {
        return null;
    }
    const clip = getTrackState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
    // The stored source includes the capture's latency lead-in. Subtract its
    // actual origin before clamping, so a compensated downbeat remains present.
    return clip ? sourceBeat(clip.startBeat - (clip.midiOffsetBeats ?? 0), position) : null;
}
