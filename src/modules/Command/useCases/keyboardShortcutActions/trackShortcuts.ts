/**
 * Track/Clip keyboard shortcut delegates.
 */
import { inject } from '#/infra/di/inject';
import { clearSolos as clearSolosImpl } from '#/modules/Arrangement/useCases/toggleTrackState/clearSolos';
import { addTrack as addTrackImpl } from '#/modules/Arrangement/useCases/addTrack';
import { duplicateTrack as duplicateTrackImpl } from '#/modules/Arrangement/useCases/duplicateTrack';
import { duplicateClip as duplicateClipImpl } from '#/modules/Arrangement/useCases/clip/duplicateClip';
import { duplicateClipToNextBar as duplicateClipToNextBarImpl } from '#/modules/Arrangement/useCases/clip/duplicateClipToNextBar';
import { zoomTracksVertical as zoomTracksVerticalImpl } from '#/modules/Arrangement/useCases/trackZoom';

export const trackShortcutsDependencies = {
    clearSolos: clearSolosImpl,
    addTrack: addTrackImpl,
    duplicateTrack: duplicateTrackImpl,
    duplicateClip: duplicateClipImpl,
    duplicateClipToNextBar: duplicateClipToNextBarImpl,
    zoomTracksVertical: zoomTracksVerticalImpl,
} as const;

export const clearSolos = inject(trackShortcutsDependencies)((d) => () => d.clearSolos());
export const addTrack = inject(trackShortcutsDependencies)(
    (d) => (opts: Parameters<typeof addTrackImpl>[0]) => {
        d.addTrack(opts);
    }
);
export const duplicateTrack = inject(trackShortcutsDependencies)((d) => (trackId: string) =>
    d.duplicateTrack(trackId)
);
export const duplicateClip = inject(trackShortcutsDependencies)((d) => (clipId: string) =>
    d.duplicateClip(clipId)
);
export const duplicateClipToNextBar = inject(trackShortcutsDependencies)((d) => (clipId: string) =>
    d.duplicateClipToNextBar(clipId)
);
export const zoomTracksVertical = inject(trackShortcutsDependencies)((d) => (delta: number) =>
    d.zoomTracksVertical(delta)
);
