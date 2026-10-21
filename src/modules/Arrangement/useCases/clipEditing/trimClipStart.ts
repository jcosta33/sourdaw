import { type AppAction } from '#/utils/handlerContract';
import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';
import { loopOriginEntry, resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

import { audioSourceAtBeat } from './audioSourceAtBeat';
import { isAudioSourceStateSnapshot } from './isAudioSourceStateSnapshot';

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

type RestoreAudioSource = NonNullable<Extract<AppAction, { type: 'trimClipStart' }>['payload']['restoreAudioSource']>;

export function trimClipStart(clipId: string, newStartBeat: number, anchorBeat?: number | null, restoreAudioSource?: RestoreAudioSource): boolean {
    if (!Number.isFinite(newStartBeat)) {
        return false;
    }
    if (restoreAudioSource && !isAudioSourceStateSnapshot(restoreAudioSource)) {
        return false;
    }

    const restoreAnchorBeat = anchorBeat !== null && !Number.isFinite(anchorBeat) ? undefined : anchorBeat;

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
            const updated: Clip = {
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
            if (context.type === 'audio') {
                const sourceAtNewStart = audioSourceAtBeat(context, startBeat);
                updated.audioOffsetSeconds = sourceAtNewStart.audioOffsetSeconds;
                updated.audioOffsetBeats = sourceAtNewStart.audioOffsetBeats;
                if (restoreAudioSource) {
                    delete updated.audioOffsetSeconds;
                    delete updated.audioOffsetBeats;
                    if (restoreAudioSource.audioOffsetSeconds !== null) {
                        updated.audioOffsetSeconds = restoreAudioSource.audioOffsetSeconds;
                    }
                    if (restoreAudioSource.audioOffsetBeats !== null) {
                        updated.audioOffsetBeats = restoreAudioSource.audioOffsetBeats;
                    }
                }
            }
            return updated;
        }
        return context;
    });
}
