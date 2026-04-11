import {
    addTrack as addTrackImpl,
    clearSolos as clearSolosImpl,
    duplicateClip as duplicateClipImpl,
    duplicateClipToNextBar as duplicateClipToNextBarImpl,
    duplicateTrack as duplicateTrackImpl,
    zoomTracksVertical as zoomTracksVerticalImpl,
} from '#/modules/Arrangement/useCases';

export const trackShortcutsDependencies = {
    clearSolos: clearSolosImpl,
    addTrack: addTrackImpl,
    duplicateTrack: duplicateTrackImpl,
    duplicateClip: duplicateClipImpl,
    duplicateClipToNextBar: duplicateClipToNextBarImpl,
    zoomTracksVertical: zoomTracksVerticalImpl,
} as const;