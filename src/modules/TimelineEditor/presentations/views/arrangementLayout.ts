import {
    ARRANGEMENT_BAR_HEIGHT,
    BEAT_RULER_HEIGHT,
    MARKER_LANE_HEIGHT,
    TIMELINE_HORIZONTAL_SCROLLBAR_HEIGHT,
    getAdjustmentLayerStripHeight,
} from '#/modules/Arrangement/presentations/views';

import { CHORD_TRACK_LANE_HEIGHT } from './Timeline/ChordTrackLane';

type ArrangementChrome = {
    adjustmentLayerCount: number;
    hasMarkers: boolean;
    /** Height of the minimap strip, or 0 while it is hidden. */
    minimapHeight: number;
    hasChords: boolean;
};

/** Height of everything stacked above the track lanes in the timeline column. */
export function getArrangementChromeHeight(chrome: ArrangementChrome): number {
    return (
        ARRANGEMENT_BAR_HEIGHT +
        getAdjustmentLayerStripHeight(chrome.adjustmentLayerCount) +
        (chrome.hasMarkers ? MARKER_LANE_HEIGHT : 0) +
        chrome.minimapHeight +
        BEAT_RULER_HEIGHT +
        (chrome.hasChords ? CHORD_TRACK_LANE_HEIGHT : 0)
    );
}

type ArrangementMinimumHeightInput = ArrangementChrome & {
    /** Height of the one track row the lanes must always keep visible. */
    surfaceMinimumHeight: number;
    /** Requested height of the scratch pad under the lanes, or 0 while it is closed. */
    scratchPadHeight: number;
};

/**
 * The least height the arrangement can be given while still showing its chrome,
 * one track row, the horizontal scrollbar strip, and an open scratch pad.
 */
export function getArrangementMinimumHeight(input: ArrangementMinimumHeightInput): number {
    return (
        getArrangementChromeHeight(input) +
        input.surfaceMinimumHeight +
        TIMELINE_HORIZONTAL_SCROLLBAR_HEIGHT +
        input.scratchPadHeight
    );
}
