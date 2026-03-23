/**
 * Track/Clip keyboard shortcut delegates.
 */
import { clearSolos as _clearSolos } from '#/modules/Track/useCases/toggleTrackState';
import { addTrack as _addTrack } from '#/modules/Track/useCases/addTrack';
import { duplicateTrack as _duplicateTrack } from '#/modules/Track/useCases/duplicateTrack';
import {
    duplicateClip as _duplicateClip,
    duplicateClipToNextBar as _duplicateClipToNextBar,
} from '#/modules/Clip/useCases/clipUseCases';
import { zoomTracksVertical as _zoomTracksVertical } from '#/modules/Track/useCases/trackZoom';

export const clearSolos = (): void => _clearSolos();
export const addTrack = (opts: Parameters<typeof _addTrack>[0]): void => {
    _addTrack(opts);
};
export const duplicateTrack = (trackId: string): void => _duplicateTrack(trackId);
export const duplicateClip = (clipId: string): void => _duplicateClip(clipId);
export const duplicateClipToNextBar = (clipId: string): void => _duplicateClipToNextBar(clipId);
export const zoomTracksVertical = (delta: number): void => _zoomTracksVertical(delta);
