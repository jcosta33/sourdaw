import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';
import { loopOriginEntry, resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

/**
 * A looped clip reads its notes at `note.startBeat - midiOffsetBeats` wrapped by
 * the loop length, so scheduling only sees the offset's phase inside
 * `[0, loopLength)` — but the piano roll, splitting, and glue all read the raw
 * figure. Wrap the trim's advance into that range so every consumer stays
 * inside the loop the clip plays. The wrap is the util's single implementation,
 * shared with `slipClipContent`.
 */
function loopedMidiOffsetBeats(clip: Clip, offset: number): number {
    return resolveLoopedOffsetBeats({
        offsetBeats: offset,
        loopEnabled: clip.loopEnabled ?? false,
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
    });
}

/**
 * The scheduler's drop gates compare the raw figure `note.startBeat -
 * midiOffsetBeats` against the loop length (selectMidiNotesForLoopWindow,
 * getGrooveProjection, and scheduleMidiNotes' admission test), so wrapping the
 * offset down by `k * loopLength` moves that boundary and silently drops notes
 * the raw advance keeps. Shifting each stored row by exactly the distance the
 * wrap moved the offset keeps `note.startBeat - midiOffsetBeats` at the raw
 * advance's figure — phase, audible window position, and drop set unchanged.
 * Every content-coordinate row lane moves together: the controller projector
 * reads its CC rows against the same `midiOffsetBeats`-relative region as the
 * note readers, so a row left behind while its clip crosses a whole loop fires
 * a loop away or never (a whole-loop trim must still fire the press at every
 * pass its note sounds). `shiftClipMidiNotes` carries notes, CC, and pitch
 * bends by the one delta and no-ops when the clip stores no rows; rows keep
 * their raw relative exactly, which under the anchored window may store a
 * wrapped head below zero (a clip trimmed a whole loop past its anchor keeps
 * its head row at `−advance`). A zero shift moves nothing: the unlooped and
 * sub-loop trims the wrap never re-bases keep their rows byte-identical.
 */
function shiftMidiRowsWithOffsetWrap(clip: Clip, rawOffsetBeats: number, wrappedOffsetBeats: number): void {
    const shiftBeats = wrappedOffsetBeats - rawOffsetBeats;
    if (shiftBeats === 0) {
        return;
    }
    shiftClipMidiNotes(clip.id, shiftBeats);
}

/**
 * Trims a clip's start. `anchorBeat` is the restore leg's exact-anchor form
 * (#5198): a recorded inverse carries the pre-action anchor state so BOTH
 * replay directions restore it — a value puts that anchor back, `null`
 * records a clip that carried none and removes any key the action minted (an
 * extension-undo replaying a rightward trim must stay anchorless, not mint at
 * the extension start). Absent — a fresh trim, or a legacy entry — keeps the
 * mint law below exactly as it always was. `restoredMidiOffsetBeats` is the
 * restore leg's exact-offset form (#5512): the pre-action stored offset a
 * recorded inverse captures, restored verbatim — see the midi branch below
 * for the arithmetic that demands it. Absent keeps the re-wrapping law.
 */
export function trimClipStart(
    clipId: string,
    newStartBeat: number,
    anchorBeat?: number | null,
    restoredMidiOffsetBeats?: number
): boolean {
    if (!Number.isFinite(newStartBeat)) {
        return false;
    }
    // A non-finite anchor is corrupted data, not an anchor state (#5198): a
    // persisted `1e999` decodes as Infinity, and writing it into clip state
    // derives a NaN loop window in every reader. Drop it to the absent form —
    // exactly the behavior a payload without the field gets.
    const restoreAnchorBeat = anchorBeat !== null && !Number.isFinite(anchorBeat) ? undefined : anchorBeat;
    // A non-finite offset capture is corrupted data on the same channel as the
    // anchor above (#5512): a persisted `1e999` decodes as Infinity, and
    // restoring it verbatim writes Infinity into clip state and shifts every
    // stored row by it. Drop it to the absent form — exactly the behavior a
    // payload without the field gets.
    const restoreMidiOffsetBeats =
        restoredMidiOffsetBeats !== undefined && !Number.isFinite(restoredMidiOffsetBeats)
            ? undefined
            : restoredMidiOffsetBeats;

    try {
        const state = getTrackState();
        if (state) {
            const target = findClipById({ clipId, tracks: state.tracks });
            if (target && newStartBeat >= target.clip.endBeat) {
                return false;
            }
        }
    } catch {
        return false;
    }

    return updateClip(clipId, (context) => {
        if (newStartBeat < context.endBeat) {
            const startBeat = Math.max(0, newStartBeat);
            const delta = startBeat - context.startBeat;
            // A trim advances the content offset but never the loop anchor:
            // the loop window and the pass count stay anchored to the source
            // (#4988). A clip born looped gets its anchor at this first trim;
            // an already-anchored clip keeps theirs. The mint only fires when
            // the trim advances the head (the start moves right): the inverse
            // leg of a pre-anchor undo entry replays `trimClipStart` at the
            // pre-trim start — a leftward move — and anchoring there derives a
            // negative advance whose window silences the restored head
            // (#5198), so a replayed entry stays anchorless at the pre-anchor
            // reading, advance zero. The key is written only when an anchor
            // results — an explicit-undefined key is a shape no clip writer
            // may leave behind (#4988).
            let restoredAnchorBeat: number | null | undefined;
            if (restoreAnchorBeat === undefined) {
                restoredAnchorBeat =
                    context.loopOriginBeat ??
                    (context.loopEnabled === true && startBeat >= context.startBeat ? context.startBeat : undefined);
            } else {
                restoredAnchorBeat = restoreAnchorBeat;
            }
            const updated = {
                ...context,
                startBeat,
                audioOffsetBeats: (context.audioOffsetBeats ?? 0) + delta,
                ...loopOriginEntry(restoredAnchorBeat === null ? undefined : restoredAnchorBeat),
            };
            if (restoredAnchorBeat === null) {
                // `loopOriginEntry` expresses "no anchor" by leaving the key
                // out; the exact-anchorless leg must also remove one the clip
                // spread carried over.
                delete updated.loopOriginBeat;
            }
            if (context.type === 'midi') {
                if (restoreMidiOffsetBeats !== undefined) {
                    // The recorded-inverse offset restore (#5512). The forward
                    // trim wrapped its raw advance against the loop length the
                    // clip plays AFTER the trim — the duration itself when
                    // `loopLength` is unset — while this replay's wrap below
                    // (`loopedMidiOffsetBeats`) derives against the length the
                    // clip plays AFTER the restore. With a configured
                    // `loopLength` the two bases are the same constant L: the
                    // forward wrap lowered the raw figure `raw` to `raw − k·L`
                    // and shifted the rows −k·L, so re-wrapping here raises by
                    // exactly k·L and the pair composes back to the captured
                    // figures. On a duration-derived loop the basis moves under
                    // the pair — the trim changed the very duration the wrap
                    // derives from — and the replay's re-derived phase lands
                    // `k·D′` away from the captured figure, displacing the
                    // stored rows the slip's own verbatim inverse then restores
                    // against. So the inverse restores its capture verbatim and
                    // shifts the rows by the exact reverse of the forward
                    // displacement: the raw figure the forward trim wrapped
                    // FROM was `capture − delta` (the replay's `delta` is the
                    // forward trim's negated), minus the offset the clip
                    // carries now. The relative law is untouched —
                    // `rows + shift − capture = rows − offset − delta`, the
                    // same figure the re-wrapping leg leaves — so a divergent
                    // replay keeps today's reading, and only the stored bytes
                    // become the ones the pre-action clip carried. Presence of
                    // the capture keys this law (zero included, the slip's
                    // `rowLiftBeats` precedent): fresh dispatches and entries
                    // recorded before the field existed take the re-wrapping
                    // leg below exactly as they always did.
                    const currentOffsetBeats = context.midiOffsetBeats ?? 0;
                    const rowShiftBeats = restoreMidiOffsetBeats - delta - currentOffsetBeats;
                    if (rowShiftBeats !== 0) {
                        shiftClipMidiNotes(clipId, rowShiftBeats);
                    }
                    return { ...updated, midiOffsetBeats: restoreMidiOffsetBeats };
                }
                const rawOffsetBeats = (context.midiOffsetBeats ?? 0) + delta;
                const midiOffsetBeats = loopedMidiOffsetBeats(updated, rawOffsetBeats);
                shiftMidiRowsWithOffsetWrap(updated, rawOffsetBeats, midiOffsetBeats);
                return { ...updated, midiOffsetBeats };
            }
            return updated;
        }
        return context;
    });
}
