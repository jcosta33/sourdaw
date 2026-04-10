/**
 * Track/Clip keyboard shortcut delegates.
 */
import {
    clearSolos as _clearSolos,
    addTrack as _addTrack,
    duplicateTrack as _duplicateTrack,
    duplicateClip as _duplicateClip,
    duplicateClipToNextBar as _duplicateClipToNextBar,
    zoomTracksVertical as _zoomTracksVertical,
} from '#/modules/Arrangement';

export const clearSolos = (): void => _clearSolos();
export const addTrack = (opts: Parameters<typeof _addTrack>[0]): void => {
    _addTrack(opts);
};
export const duplicateTrack = (trackId: string): void => _duplicateTrack(trackId);
export const duplicateClip = (clipId: string): void => _duplicateClip(clipId);
export const duplicateClipToNextBar = (clipId: string): void => _duplicateClipToNextBar(clipId);
export const zoomTracksVertical = (delta: number): void => _zoomTracksVertical(delta);
