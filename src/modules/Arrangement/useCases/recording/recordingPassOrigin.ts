import { transportStore } from '#/modules/Transport/stores';

import { activeRecordingRef, type RecordingPassOrigin } from '../../stores/activeRecordingRef';

import { passDepthAt } from './passDepthAt';

function latestFixedPass(pass: number): number {
    let fixed = pass;
    while (fixed > 0 && !activeRecordingRef.passOrigins.has(fixed)) {
        fixed -= 1;
    }
    return fixed;
}

/**
 * Where a pass of this recording begins. Staging a pass fixes the origin of the
 * pass after it, so a loop edited mid-pass moves no event of that pass; passes
 * no staged pass has reached yet run on the live loop.
 */
export function recordingPassOrigin(pass: number): RecordingPassOrigin | null {
    const fixed = latestFixedPass(pass);
    const origin = activeRecordingRef.passOrigins.get(fixed) ?? {
        unwrappedBeat: activeRecordingRef.startBeat,
        beat: activeRecordingRef.startBeat,
    };
    if (fixed === pass) {
        return origin;
    }
    const loop = transportStore.value;
    if (!loop || loop.loopEnd <= loop.loopStart) {
        return null;
    }
    return {
        unwrappedBeat: passDepthAt(origin) + loop.loopEnd + (pass - fixed - 1) * (loop.loopEnd - loop.loopStart),
        beat: loop.loopStart,
    };
}
