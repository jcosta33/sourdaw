import { automationStore } from '../../stores/automationStore';

import { laneBaselines } from './recordingSessionState';

/**
 * Record a lane's points as they stand right now, unless this session already
 * recorded them.
 *
 * Called immediately before every write the recording session makes to a lane,
 * so the stored copy is always the state the lane was in before the session
 * touched it — however many flushes and range clears follow. `stopAutomationRecording`
 * diffs against this to build the undo entry; taking that snapshot at stop
 * instead would already include everything a touch release flushed mid-session.
 *
 * First capture wins: a second gesture on the same lane in the same session
 * must not re-baseline onto the first gesture's result, or undo would only
 * reach back one gesture.
 */
export function captureLaneBaseline(laneId: string): void {
    if (laneBaselines.has(laneId)) {
        return;
    }
    const lane = automationStore.value?.lanes.find((candidate) => candidate.id === laneId);
    if (!lane) {
        return;
    }
    laneBaselines.set(
        laneId,
        lane.points.map((point) => ({ ...point }))
    );
}
