import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { passDepthAt, recordingPassOrigin } from './recordingPassOrigin';

/**
 * Fix where the pass after `pass` begins, once `pass` is staged as ending at `endBeat`.
 * Takes play a pass from the clip start, so a pass's depth is its source beat at the
 * clip start: it grows by what this pass recorded past the next pass's entry, and a
 * jump forward leaves a gap in the source rather than a negative depth.
 */
export function closeRecordingPass(pass: number, endBeat: number, nextPassStartBeat: number): void {
    const origin = recordingPassOrigin(pass);
    if (!origin) {
        return;
    }
    activeRecordingRef.passOrigins.set(pass + 1, {
        unwrappedBeat: passDepthAt(origin) + Math.max(endBeat, nextPassStartBeat),
        beat: nextPassStartBeat,
    });
}
