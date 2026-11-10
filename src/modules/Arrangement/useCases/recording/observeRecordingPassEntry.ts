import { activeRecordingRef } from '../../stores/activeRecordingRef';

import { recordingPassTiming } from './recordingPassTiming';

/** Observe the physical first loop entry while the provisional recording owns it. */
export function observeRecordingPassEntry(
    beat: number,
    contextSeconds: number,
    relocated = false,
    cancelledBoundary = false
): void {
    if (activeRecordingRef.current.length === 0) {
        return;
    }
    if (cancelledBoundary) {
        for (const clipId of activeRecordingRef.current) {
            recordingPassTiming.cancelBoundary(clipId, contextSeconds);
        }
    }
    recordingPassTiming.observeEntry(activeRecordingRef.current, beat, contextSeconds, relocated);
}
