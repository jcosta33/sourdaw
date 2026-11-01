import { initClipSelectionReconciliation } from './initClipSelectionReconciliation';
import { initTimelineScrollClamp } from './initTimelineScrollClamp';

/**
 * Starts the reconciliations that keep timeline view state valid as the track
 * list changes: the vertical scroll clamp and the clip selection.
 */
export function initTimelineViewReconciliation(): () => void {
    const stops = [initTimelineScrollClamp(), initClipSelectionReconciliation()];
    return () => {
        for (const stop of stops) {
            stop();
        }
    };
}
