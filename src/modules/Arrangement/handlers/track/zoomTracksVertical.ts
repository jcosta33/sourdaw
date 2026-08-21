import { createHandler } from '#/utils/createHandler';
import { type TrackHeightSnapshot } from '#/utils/handlerContract';

import { clampTrackHeight, DEFAULT_TRACK_HEIGHT } from '../../useCases/clampTrackHeight';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { zoomTracksVertical } from '../../useCases/trackZoom';

function captureHeights(delta: number): { previous: TrackHeightSnapshot[]; settled: TrackHeightSnapshot[] } {
    const tracks = getTrackStoreState()?.tracks ?? [];
    return {
        previous: tracks.map((track) => ({ trackId: track.id, height: track.height ?? DEFAULT_TRACK_HEIGHT })),
        settled: tracks.map((track) => ({ trackId: track.id, height: clampTrackHeight(track.height, delta) })),
    };
}

export const handleZoomTracksVertical = createHandler<'zoomTracksVertical'>({
    execute: (action) => {
        zoomTracksVertical(action.payload.delta);
    },
    describe: (alpha) => {
        const { previous, settled } = captureHeights(alpha.payload.delta);
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
