import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';
import { MAX_TRACK_ZOOM_DELTA } from '#/utils/trackHeightLimits';

import { type TrackHeightSnapshot } from '../../events/arrangementTrackAppActions';
import { clampTrackHeight, DEFAULT_TRACK_HEIGHT } from '../../useCases/clampTrackHeight';
import { zoomTracksVertical } from '../../useCases/trackZoom';

import { isZoomTracksVerticalSessionEntry } from './isZoomTracksVerticalSessionEntry';
import { readPlannedDisplayTracks } from './readPlannedDisplayTrack';

function captureHeights(
    delta: number,
    context?: HandlerValidationContext
): { previous: TrackHeightSnapshot[]; settled: TrackHeightSnapshot[] } {
    const tracks = readPlannedDisplayTracks(context);
    return {
        previous: tracks.map((track) => ({ trackId: track.id, height: track.height ?? DEFAULT_TRACK_HEIGHT })),
        settled: tracks.map((track) => ({ trackId: track.id, height: clampTrackHeight(track.height, delta) })),
    };
}

function findRefusal(delta: number): string | null {
    if (Number.isFinite(delta) && delta !== 0 && Math.abs(delta) <= MAX_TRACK_ZOOM_DELTA) {
        return null;
    }
    return `A vertical zoom of ${delta} pixels moves no track; use a nonzero delta within ${MAX_TRACK_ZOOM_DELTA}`;
}

export const handleZoomTracksVertical = createHandler<'zoomTracksVertical'>({
    validate: (action) => findRefusal(action.payload.delta) === null,
    validationRefusalReason: (action) => findRefusal(action.payload.delta),
    validateSessionEntry: isZoomTracksVerticalSessionEntry,
    execute: (action) => {
        zoomTracksVertical(action.payload.delta);
    },
    describe: (alpha, context) => {
        // Earlier actions of a batch may resize rows, so the heights this zoom starts from and
        // settles at are read as they leave them; the restore guards then match at undo time.
        const { previous, settled } = captureHeights(alpha.payload.delta, context);
        if (previous.length === 0) {
            return { label: 'Zoom tracks vertical', inverseAction: null };
        }
        return {
            label: `Zoom tracks vertical ${alpha.payload.delta > 0 ? 'in' : 'out'}`,
            // Zooming clamps into a fixed range, so a track already at a bound does not
            // move. Applying the opposite delta would then push it off that bound to a
            // height it never had, which is why the inverse carries the prior heights.
            inverseAction: { type: 'restoreTrackHeights', payload: { expected: settled, replacement: previous } },
            redoAction: { type: 'restoreTrackHeights', payload: { expected: previous, replacement: settled } },
        };
    },
    // Every track already sitting at the bound this delta pushes toward means the zoom
    // writes nothing, and an undo entry for it would be a step that does nothing.
    isNoop: (action) => {
        const { previous, settled } = captureHeights(action.payload.delta);
        return previous.every((entry, index) => entry.height === settled[index]?.height);
    },
    undoable: true,
});
