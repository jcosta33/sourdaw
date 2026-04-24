import { pushUndoEntry } from '#/modules/Command/stores';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { removeClip } from '../clip/removeClip';

import { splitClip } from './splitClip';

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

    const rightClipId = splitClip(clipId, splitBeat);

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
