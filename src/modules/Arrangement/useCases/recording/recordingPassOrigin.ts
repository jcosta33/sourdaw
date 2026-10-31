import { transportStore } from '#/modules/Transport/stores';

import { activeRecordingRef, type RecordingPassOrigin } from '../../stores/activeRecordingRef';

function latestStagedPass(pass: number): number {
    let staged = pass;
    while (staged > 0 && !activeRecordingRef.passOrigins.has(staged)) {
        staged -= 1;
    }
    return staged;
}

/**
 * Where a pass of this recording begins. A staged pass fixes the origin of the
 * pass after it, so a loop edited mid-pass moves no event of that pass; passes
 * not yet reached by a staged one run on the live loop.
 */
export function recordingPassOrigin(pass: number): RecordingPassOrigin | null {
    const staged = latestStagedPass(pass);
    const origin = activeRecordingRef.passOrigins.get(staged) ?? {
        unwrappedBeat: activeRecordingRef.startBeat,
        beat: activeRecordingRef.startBeat,
    };
    if (staged === pass) {
        return origin;
    }
    const loop = transportStore.value;
    if (!loop || loop.loopEnd <= loop.loopStart) {
        return null;
    }
    return {
        unwrappedBeat:
            origin.unwrappedBeat +
            Math.max(0, loop.loopEnd - origin.beat) +
            (pass - staged - 1) * (loop.loopEnd - loop.loopStart),
        beat: loop.loopStart,
    };
}
