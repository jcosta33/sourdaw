import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { recordingPassOrigin } from './recordingPassOrigin';

/** A loop beat of one pass, unwrapped into the clip opened by this recording. */
export function passSourceBeat(clipStartBeat: number, pass: number, beat: number): number | null {
    if (!Number.isFinite(beat)) {
        return null;
    }
    if (pass === 0) {
        return Math.max(0, beat - clipStartBeat);
    }
    if (!activeRecordingRef.startedLooping) {
        return null;
    }
    const origin = recordingPassOrigin(pass);
    if (!origin) {
        return null;
    }
    return Math.max(0, origin.unwrappedBeat - clipStartBeat) + Math.max(0, beat - origin.beat);
}
