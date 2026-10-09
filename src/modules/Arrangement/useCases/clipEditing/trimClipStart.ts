import { getNotesForClip, setNotesForClip } from '#/modules/MIDI/useCases';
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
 * the raw advance keeps. Shifting each stored note by exactly the distance the
 * wrap moved the offset keeps `note.startBeat - midiOffsetBeats` at the raw
 * advance's figure — phase, audible window position, and drop set unchanged.
 * Kept notes hold that relative inside `[0, loopLength)`, so the shift cannot
 * move a sounding note's media below zero.
 */
function shiftNotesWithOffsetWrap(clip: Clip, rawOffsetBeats: number, wrappedOffsetBeats: number): void {
    const shiftBeats = wrappedOffsetBeats - rawOffsetBeats;
    if (shiftBeats === 0) {
        return;
    }
    const notes = getNotesForClip(clip.id);
    if (notes.length === 0) {
        return;
    }
    setNotesForClip(
        clip.id,
        notes.map((note) => {
            return { ...note, startBeat: note.startBeat + shiftBeats };
        })
    );
}

export function trimClipStart(clipId: string, newStartBeat: number): boolean {
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
            const updated = {
                ...context,
                startBeat,
                audioOffsetBeats: (context.audioOffsetBeats ?? 0) + delta,
                // A trim advances the content offset but never the loop anchor:
                // the loop window and the pass count stay anchored to the source
                // (#4988). A clip born looped gets its anchor at this first trim;
                // an already-anchored clip keeps theirs. The key is written only
                // when an anchor results — an explicit-undefined key is a shape
                // no clip writer may leave behind (#4988).
                ...loopOriginEntry(
                    context.loopOriginBeat ?? (context.loopEnabled === true ? context.startBeat : undefined)
                ),
            };
            if (context.type === 'midi') {
                const rawOffsetBeats = (context.midiOffsetBeats ?? 0) + delta;
                const midiOffsetBeats = loopedMidiOffsetBeats(updated, rawOffsetBeats);
                shiftNotesWithOffsetWrap(updated, rawOffsetBeats, midiOffsetBeats);
                return { ...updated, midiOffsetBeats };
            }
            return updated;
        }
        return context;
    });
}
