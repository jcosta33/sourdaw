import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { splitClip } from './splitClip';
import { removeClip } from '../clip/removeClip';

export function splitClipWithUndo(clipId: string, splitBeat: number): void {
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
