import { initClipSelectionReconciliation } from './initClipSelectionReconciliation';
import { initTimelineScrollClamp } from './initTimelineScrollClamp';
import { initTrackSelectionVisibility } from './initTrackSelectionVisibility';

/**
 * Starts the reconciliations that keep timeline view state valid as the track
 * list changes: the vertical scroll clamp, the clip selection and the track selection.
 */
export function initTimelineViewReconciliation(): () => void {
    const stops = [initTimelineScrollClamp(), initClipSelectionReconciliation(), initTrackSelectionVisibility()];
    return () => {
        for (const stop of stops) {
            stop();
        }
    };
}
