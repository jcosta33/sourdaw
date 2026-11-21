import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

import { type TrackHeightSnapshot } from '../../events/arrangementTrackAppActions';
import { clampTrackHeight } from '../../useCases/clampTrackHeight';

function sameHeights(left: readonly TrackHeightSnapshot[], right: readonly TrackHeightSnapshot[]): boolean {
    return (
        left.length === right.length &&
        left.every((entry, index) => entry.trackId === right[index]?.trackId && entry.height === right[index].height)
    );
}

/**
 * A saved vertical zoom is replayable only when its undo restores the heights it moved from the
 * heights the zoom's own clamp leaves, and its redo is exactly that restore reversed. A restore
 * naming other tracks or heights is no inverse of this zoom, so a replay would write heights the
 * zoom never produced.
 */
export function isZoomTracksVerticalSessionEntry(entry: HandlerSessionActionEntry): boolean {
    const { action, inverseAction, redoAction } = entry;
    if (
        action.type !== 'zoomTracksVertical' ||
        inverseAction?.type !== 'restoreTrackHeights' ||
        redoAction?.type !== 'restoreTrackHeights'
    ) {
        return false;
    }
    const { expected: settled, replacement: previous } = inverseAction.payload;
    return (
        previous.length > 0 &&
        settled.length === previous.length &&
        sameHeights(redoAction.payload.expected, previous) &&
        sameHeights(redoAction.payload.replacement, settled) &&
        settled.every(
            (entry, index) =>
                entry.trackId === previous[index]?.trackId &&
                entry.height === clampTrackHeight(previous[index].height, action.payload.delta)
        )
    );
}
