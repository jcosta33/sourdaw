import { inject } from '#/infra/di/inject';
import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { updateClip } from '#/modules/Arrangement/repositories/track/updateClip';
import { splitClip } from './splitClip';
import { removeClip } from '#/modules/Arrangement/useCases/clip/removeClip';
import { pushUndoEntry } from '#/modules/Command/useCases/pushUndoEntry';

/**
 * Split a clip at `splitBeat` and register a single undo entry that
 * fully restores the original clip shape.
 *
 * Undo: removes the right fragment and restores the left clip's
 * original endBeat, name, and fadeOut (the properties splitClip changes).
 * Redo: re-runs the split from the now-restored original.
 */
export const splitClipWithUndo = inject({ getTrackState, updateClip })(
    ({ getTrackState, updateClip }) =>
        function splitClipWithUndo(clipId: string, splitBeat: number): void {
            const origClip = getTrackState()
                ?.tracks.flatMap((t) => t.clips)
                .find((c) => c.id === clipId);
            if (!origClip) {
                return;
            }

            // Freeze the fields splitClip mutates on the left clip
            const savedEndBeat = origClip.endBeat;
            const savedName = origClip.name;
            const savedFadeOut = origClip.fadeOutBeats;

            splitClip(clipId, splitBeat);

            // The right fragment is the only new clip on the same track inside the original bounds
            const rightClipId = getTrackState()
                ?.tracks.flatMap((t) => t.clips)
                .find(
                    (c) =>
                        c.id !== clipId &&
                        c.trackId === origClip.trackId &&
                        c.startBeat >= origClip.startBeat &&
                        c.endBeat <= origClip.endBeat
                )?.id;

            if (!rightClipId) {
                // splitBeat was out of range or snapping collapsed the split — nothing to undo
                return;
            }

            pushUndoEntry(
                'Split clip',
                () => {
                    removeClip(rightClipId);
                    updateClip(clipId, (c) => ({
                        ...c,
                        endBeat: savedEndBeat,
                        name: savedName,
                        fadeOutBeats: savedFadeOut,
                    }));
                },
                () => splitClip(clipId, splitBeat)
            );
        }
);
