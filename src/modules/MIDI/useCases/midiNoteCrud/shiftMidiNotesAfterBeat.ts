import { trackStore } from '#/modules/Arrangement/stores';

import { midiStore } from '../../stores/midiStore';

export type ShiftMidiNotesAfterBeatInput = {
    /** Beat at which the shift window opens. Notes starting at or after this beat move. */
    atBeat: number;
    /** Beats to shift by. Positive = pushed right (insert time). Negative = pulled left (delete time). */
    delta: number;
};

/**
 * Time-window shift for arrangement-level time operations (insertTime).
 *
 * Notes are stored clip-relative (playback position is
 * `clip.startBeat + note.startBeat - clip.midiOffsetBeats`), so the shift
 * must NOT be applied as a flat timeline window:
 *
 *  - Clips starting at/after `atBeat` already had their rectangle moved by
 *    the caller — their clip-relative notes must stay put (previously they
 *    were shifted a second time, M-141).
 *  - Clips straddling `atBeat` keep their start — only notes whose
 *    timeline position falls inside the window shift, i.e. notes with
 *    media beat >= atBeat - clip.startBeat + midiOffsetBeats.
 *
 * Writes once to the store regardless of clip count.
 */
export function shiftMidiNotesAfterBeat(input: ShiftMidiNotesAfterBeatInput): void {
    const { atBeat, delta } = input;
    if (delta === 0) {
        return;
    }

    const state = midiStore.value;
    if (!state) {
        return;
    }

    const trackState = trackStore.value;
    const clipById = new Map<string, { startBeat: number; endBeat: number; midiOffsetBeats?: number }>();
    for (const track of trackState?.tracks ?? []) {
        for (const clip of track.clips) {
            clipById.set(clip.id, clip);
        }
    }

    // A clip's notes shift only when the clip straddles the window; moved
    // clips keep their relative notes.
    const shiftsClip = (clipId: string): { windowStartMedia: number } | null => {
        const clip = clipById.get(clipId);
        if (!clip) {
            return null;
        }
        if (clip.startBeat >= atBeat) {
            return null;
        }
        if (clip.endBeat <= atBeat) {
            return null;
        }
        return { windowStartMedia: atBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0) };
    };

    let changed = false;

    const nextNotes: typeof state.notesByClipId = {};
    for (const [clipId, notes] of Object.entries(state.notesByClipId)) {
        const shift = shiftsClip(clipId);
        if (!shift) {
            nextNotes[clipId] = notes;
            continue;
        }
        nextNotes[clipId] = notes.map((node) => {
            if (node.startBeat >= shift.windowStartMedia) {
                changed = true;
                return { ...node, startBeat: node.startBeat + delta };
            }
            return node;
        });
    }

    const nextCc: typeof state.ccByClipId = {};
    for (const [clipId, events] of Object.entries(state.ccByClipId)) {
        const shift = shiftsClip(clipId);
        if (!shift) {
            nextCc[clipId] = events;
            continue;
        }
        nextCc[clipId] = events.map((event) => {
            if (event.beat >= shift.windowStartMedia) {
                changed = true;
                return { ...event, beat: event.beat + delta };
            }
            return event;
        });
    }

    const nextPb: typeof state.pitchBendByClipId = {};
    for (const [clipId, events] of Object.entries(state.pitchBendByClipId)) {
        const shift = shiftsClip(clipId);
        if (!shift) {
            nextPb[clipId] = events;
            continue;
        }
        nextPb[clipId] = events.map((event) => {
            if (event.beat >= shift.windowStartMedia) {
                changed = true;
                return { ...event, beat: event.beat + delta };
            }
            return event;
        });
    }

    if (!changed) {
        return;
    }

    midiStore.set({
        ...state,
        notesByClipId: nextNotes,
        ccByClipId: nextCc,
        pitchBendByClipId: nextPb,
    });
}
