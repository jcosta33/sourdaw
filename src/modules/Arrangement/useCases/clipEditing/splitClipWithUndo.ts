import { pushUndoEntry } from '#/modules/Command/useCases';
import { getMidiStoreState, restoreMidiClipData } from '#/modules/MIDI/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { removeClip } from '../clip/removeClip';

import { splitClip } from './splitClip';

export function splitClipWithUndo(clipId: string, splitBeat: number): void {
    const origClip = getTrackState()
        ?.tracks.flatMap((time) => time.clips)
        .find((context) => context.id === clipId);
    if (!origClip) {
        return;
    }

    // Freeze the fields splitClip mutates on the left clip
    const savedEndBeat = origClip.endBeat;
    const savedName = origClip.name;
    const savedFadeOut = origClip.fadeOutBeats;

    // Freeze the source clip's MIDI data before splitClip repartitions it
    // (straddling notes get trimmed on the left copy). Undo must reinstate this
    // snapshot — removeClip only deletes the right clip's entries and updateClip
    // restores just the clip rectangle — mirroring the handleRemoveClip /
    // handleRestoreClip snapshot pattern. The right clip's entries are frozen
    // after the split so redo can reinstate them under the new right clip id.
    const midiBefore = getMidiStoreState();
    const sourceNotesSnapshot = midiBefore?.notesByClipId[clipId] ?? null;
    const sourceCcSnapshot = midiBefore?.ccByClipId[clipId] ?? null;
    const sourcePitchBendSnapshot = midiBefore?.pitchBendByClipId[clipId] ?? null;

    const rightClipId = splitClip(clipId, splitBeat);

    if (!rightClipId) {
        // splitBeat was out of range or snapping collapsed the split — nothing to undo
        return;
    }

    const midiAfter = getMidiStoreState();
    const rightNotesSnapshot = midiAfter?.notesByClipId[rightClipId] ?? null;
    const rightCcSnapshot = midiAfter?.ccByClipId[rightClipId] ?? null;
    const rightPitchBendSnapshot = midiAfter?.pitchBendByClipId[rightClipId] ?? null;

    pushUndoEntry(
        'Split clip',
        () => {
            removeClip(rightClipId);
            updateClip(clipId, (context) => ({
                ...context,
                endBeat: savedEndBeat,
                name: savedName,
                fadeOutBeats: savedFadeOut,
            }));
            restoreMidiClipData({
                clipId,
                notesSnapshot: sourceNotesSnapshot ? structuredClone(sourceNotesSnapshot) : null,
                controlChangeSnapshot: sourceCcSnapshot ? structuredClone(sourceCcSnapshot) : null,
                pitchBendSnapshot: sourcePitchBendSnapshot ? structuredClone(sourcePitchBendSnapshot) : null,
            });
        },
        () => {
            const newRightClipId = splitClip(clipId, splitBeat);
            if (!newRightClipId) {
                return null;
            }
            // splitClip re-partitions from the restored source notes; reinstate the
            // frozen right-half data so straddle-cut notes keep their identity.
            restoreMidiClipData({
                clipId: newRightClipId,
                notesSnapshot: rightNotesSnapshot ? structuredClone(rightNotesSnapshot) : null,
                controlChangeSnapshot: rightCcSnapshot ? structuredClone(rightCcSnapshot) : null,
                pitchBendSnapshot: rightPitchBendSnapshot ? structuredClone(rightPitchBendSnapshot) : null,
            });
            return newRightClipId;
        }
    );
}
