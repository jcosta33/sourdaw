import { pushUndoEntry, REDO_NOT_APPLIED } from '#/modules/Command/useCases';
import { getMidiStoreState, restoreMidiClipData } from '#/modules/MIDI/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { readClipSatelliteEntry, writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { removeClip } from '../clip/removeClip';

import { splitClip } from './splitClip';

export function splitClipWithUndo(clipId: string, splitBeat: number): void {
    if (!Number.isFinite(splitBeat)) {
        return;
    }

    const resolution = resolveEligibleClipWriteTarget({ clipId });
    if (resolution.status !== 'eligible') {
        return;
    }

    const state = getTrackState();
    const targetTrack = state?.tracks.find((track) => track.id === resolution.trackId);
    const origClip = targetTrack?.clips.find((context) => context.id === clipId);
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

    // Same freeze for the source clip's satellites (gain envelope, warp state):
    // splitClip repartitions them across both halves, so undo must put the
    // source entry back and clear the right half's.
    const sourceSatelliteBefore = readClipSatelliteEntry(clipId);

    const rightClipId = splitClip(clipId, splitBeat);

    if (!rightClipId) {
        // splitBeat was out of range or snapping collapsed the split — nothing to undo
        return;
    }

    const midiAfter = getMidiStoreState();
    const rightNotesSnapshot = midiAfter?.notesByClipId[rightClipId] ?? null;
    const rightCcSnapshot = midiAfter?.ccByClipId[rightClipId] ?? null;
    const rightPitchBendSnapshot = midiAfter?.pitchBendByClipId[rightClipId] ?? null;
    const leftSatelliteAfter = readClipSatelliteEntry(clipId);
    const rightSatelliteAfter = readClipSatelliteEntry(rightClipId);

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
            writeClipSatelliteEntry(sourceSatelliteBefore);
            writeClipSatelliteEntry({ clipId: rightClipId, gainEnvelope: null, warpState: null });
        },
        () => {
            // Redo reuses the original right clip id (deterministic id reuse, chosen
            // over remapping captured ids through previous redo results — that would
            // need shared cross-entry state). Undo removed the original right clip
            // and its MIDI data, so the id is provably free, and id-stability keeps
            // stacked cuts on this lineage redoable: the next entry's redo splits
            // the right clip this redo recreates.
            const newRightClipId = splitClip(clipId, splitBeat, rightClipId);
            if (!newRightClipId) {
                // The split is genuinely rejected now (e.g. the clip was trimmed past
                // splitBeat after the undo) — surface it (importMidiFile precedent)
                // and report not-applied so the entry leaves the future stack
                // instead of deadlocking the entries behind it.
                notifyUser('Failed to redo split clip - the clip no longer spans the split beat', 'error');
                return REDO_NOT_APPLIED;
            }
            // splitClip re-partitions from the restored source notes; reinstate the
            // frozen right-half data so straddle-cut notes keep their identity.
            restoreMidiClipData({
                clipId: newRightClipId,
                notesSnapshot: rightNotesSnapshot ? structuredClone(rightNotesSnapshot) : null,
                controlChangeSnapshot: rightCcSnapshot ? structuredClone(rightCcSnapshot) : null,
                pitchBendSnapshot: rightPitchBendSnapshot ? structuredClone(rightPitchBendSnapshot) : null,
            });
            // The re-split's seam points carry deterministic ids, so its satellite
            // writes already match these captures — reinstate them anyway, mirroring
            // the MIDI snapshot pattern above.
            writeClipSatelliteEntry(leftSatelliteAfter);
            writeClipSatelliteEntry(rightSatelliteAfter);
            return newRightClipId;
        }
    );
}
