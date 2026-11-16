import { type KeyboardEvent } from 'react';

type LanePoint = { beat: number; value: number };

/**
 * The value a clip lane's line passes through at `beat`: straight between the
 * points either side, held flat before the first and after the last. CC and
 * pitch-bend lanes draw straight segments, so a point inserted here leaves the
 * line where it was. `undefined` when the lane has no points.
 */
export function readLaneValueAtBeat(points: readonly LanePoint[], beat: number): number | undefined {
    let before: LanePoint | undefined;
    let after: LanePoint | undefined;
    for (const point of points) {
        if (point.beat <= beat && (before === undefined || point.beat >= before.beat)) {
            before = point;
        }
        if (point.beat > beat && (after === undefined || point.beat < after.beat)) {
            after = point;
        }
    }
    if (before === undefined) {
        return after?.value;
    }
    if (after === undefined) {
        return before.value;
    }
    const progress = (beat - before.beat) / (after.beat - before.beat);
    return before.value + (after.value - before.value) * progress;
}

/**
 * Enter on a focused clip lane inserts a point at the playhead, the keyboard
 * route to the lane's click-to-add. The key is claimed even when the playhead
 * is outside the clip, so it never falls through to the transport shortcut.
 * Keys from the points inside the lane, and modified presses, are left alone.
 */
export function handleClipLaneInsertKeyDown(event: KeyboardEvent<HTMLElement>, insertAtPlayhead: () => void): void {
    if (event.target !== event.currentTarget || event.key !== 'Enter') {
        return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    insertAtPlayhead();
}
