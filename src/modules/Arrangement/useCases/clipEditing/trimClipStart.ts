import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';
import { loopOriginEntry } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

/**
 * A looped clip reads its notes at `note.startBeat - midiOffsetBeats` wrapped by
 * the loop length, so scheduling only sees the offset's phase inside
 * `[0, loopLength)` — but the piano roll, splitting, and glue all read the raw
 * figure. Wrap the trim's advance into that range so every consumer stays
 * inside the loop the clip plays.
 */
function loopedMidiOffsetBeats(clip: Clip, offset: number): number {
    const loopEnabled = clip.loopEnabled ?? false;
    if (!loopEnabled) {
        return offset;
    }
    const { loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    });
    return ((offset % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
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
 * mint law below exactly as it always was.
 */
export function trimClipStart(clipId: string, newStartBeat: number, anchorBeat?: number | null): boolean {
    if (!Number.isFinite(newStartBeat)) {
        return false;
    }

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
            if (anchorBeat === undefined) {
                restoredAnchorBeat =
                    context.loopOriginBeat ??
                    (context.loopEnabled === true && startBeat >= context.startBeat ? context.startBeat : undefined);
            } else {
                restoredAnchorBeat = anchorBeat;
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
