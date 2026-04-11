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

export function clearSolos() {
    return clearSolosImpl();
}

export function addTrack(opts: Parameters<typeof addTrackImpl>[0]) {
    addTrackImpl(opts);
}

export function duplicateTrack(trackId: string) {
    return duplicateTrackImpl(trackId);
}

export function duplicateClip(clipId: string) {
    return duplicateClipImpl(clipId);
}

export function duplicateClipToNextBar(clipId: string) {
    return duplicateClipToNextBarImpl(clipId);
}

export function zoomTracksVertical(delta: number) {
    return zoomTracksVerticalImpl(delta);
}
