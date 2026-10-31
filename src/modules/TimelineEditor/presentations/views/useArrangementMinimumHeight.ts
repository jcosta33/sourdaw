import { useStore } from '#/infra/store/useStore';
import { adjustmentLayerStore, markerStore, trackStore } from '#/modules/Arrangement/stores';
import { getTimelineSurfaceMinimumHeight } from '#/modules/Arrangement/useCases';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { preferencesStore } from '#/modules/Preferences/stores';
import { normalizeTimelineMinimapHeight } from '#/utils/TimelineMinimap/timelineMinimapHeight';

import { useWorkspaceState } from '../hooks/useWorkspaceState';

import { getArrangementMinimumHeight } from './arrangementLayout';
import { getScratchPadRenderedHeight } from './Timeline/scratchPadHeight';

/** A live resize preview wins over the stored minimap height while it lasts. */
function getRenderedMinimapHeight(showMinimap: boolean, previewHeight: number | null, storedHeight: number): number {
    if (!showMinimap) {
        return 0;
    }
    return previewHeight ?? normalizeTimelineMinimapHeight(storedHeight);
}

/**
 * The least height the shell must leave the arrangement, so a crowded bottom
 * dock can never squeeze the lanes below one visible track. Zero where the
 * arrangement is not what the workspace shows. It sums the heights actually
 * rendered: the minimap's live resize preview, and a collapsed scratch pad's
 * header strip.
 */
export const useArrangementMinimumHeight = (): number => {
    const { mode, scratchPadOpen, scratchPadHeight, scratchPadCollapsed, timelineMinimapPreviewHeight } =
        useWorkspaceState();
    const { tracks, selectedTrackId } = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const markerState = useStore(markerStore, { markers: [], sections: [] });
    const chordState = useStore(chordTrackStore, { enabled: false, events: [] });
    const adjustmentState = useStore(adjustmentLayerStore, { layers: [] });
    const preferences = useStore(preferencesStore);

    const hasUserTracks = tracks.some((track) => track.kind !== 'master' && track.kind !== 'folder');
    if (mode === 'automation' || !hasUserTracks) {
        return 0;
    }

    return getArrangementMinimumHeight({
        adjustmentLayerCount: adjustmentState.layers.length,
        hasMarkers: markerState.markers.length > 0,
        minimapHeight: getRenderedMinimapHeight(
            preferences.showMinimap,
            timelineMinimapPreviewHeight,
            preferences.timelineMinimapHeight
        ),
        hasChords: chordState.events.length > 0 || chordState.enabled,
        surfaceMinimumHeight: getTimelineSurfaceMinimumHeight(tracks, selectedTrackId),
        scratchPadHeight: scratchPadOpen ? getScratchPadRenderedHeight(scratchPadCollapsed, scratchPadHeight) : 0,
    });
};
