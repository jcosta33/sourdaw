import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { recordingPassOrigin } from './recordingPassOrigin';

/** Fix where the pass after `pass` begins, once `pass` is staged as ending at `endBeat`. */
export function closeRecordingPass(pass: number, endBeat: number, nextPassStartBeat: number): void {
    const origin = recordingPassOrigin(pass);
    if (!origin) {
        return;
    }
    activeRecordingRef.passOrigins.set(pass + 1, {
        unwrappedBeat: origin.unwrappedBeat + Math.max(0, endBeat - origin.beat),
        beat: nextPassStartBeat,
    });
}
