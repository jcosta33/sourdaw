import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { recordingPassIndex } from './recordingPassIndex';

type EventPosition = { beat: number; passIndex: number };

/** One admitted event's unwrapped position in the clip opened by this recording. */
export function sourceBeat(clipStartBeat: number, position: EventPosition): number | null {
    const pass = recordingPassIndex(position);
    if (!Number.isFinite(position.beat) || pass === null) {
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
