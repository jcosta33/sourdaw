import { getTrackState } from '../../repositories/track/getTrackState';
import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { sourceBeat } from './sourceBeat';
import { takeOwnsRecordingRoot } from './takeOwnsRecordingRoot';

type EventPosition = { beat: number; passIndex: number };

export function recordingMidiSourceBeatAt(clipId: string, position: EventPosition): number | null {
    if (!takeOwnsRecordingRoot() || !activeRecordingRef.current.includes(clipId)) {
        return null;
    }
    const clip = getTrackState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId);
    return clip ? sourceBeat(clip.startBeat, position) : null;
}
