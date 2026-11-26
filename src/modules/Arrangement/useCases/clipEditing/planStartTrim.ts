import { loopOriginEntry, resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

import { type Clip } from '../../models/Track';

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

export type StartTrimPlan = {
    clip: Clip;
    /** The beats the MIDI rows shift by, or null when the clip carries none. */
    rowShiftBeats: number | null;
};

/** The clip with its head at `startBeat`, carrying the anchor the trim leaves it. */
function withTrimmedHead(context: Clip, startBeat: number, restoreAnchorBeat: number | null | undefined): Clip {
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
    return updated;
}

/** The MIDI clip's offset after the trim, and the row shift that keeps its notes where they play. */
function planMidiOffset(
    context: Clip,
    updated: Clip,
    delta: number,
    restoreMidiOffsetBeats: number | undefined
): StartTrimPlan | 'refused' {
    if (!Number.isFinite(delta) || !Number.isFinite(updated.audioOffsetBeats)) {
        return 'refused';
    }
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
        return { clip: { ...updated, midiOffsetBeats: restoreMidiOffsetBeats }, rowShiftBeats };
    }
    const rawOffsetBeats = (context.midiOffsetBeats ?? 0) + delta;
    const midiOffsetBeats = loopedMidiOffsetBeats(updated, rawOffsetBeats);
    if (!Number.isFinite(midiOffsetBeats)) {
        return 'refused';
    }
    return { clip: { ...updated, midiOffsetBeats }, rowShiftBeats: midiOffsetBeats - rawOffsetBeats };
}

/**
 * The clip a trim of the start leaves, and the shift of its MIDI rows, as pure laws over the clip as
 * it stands. Null when the requested start does not precede the clip's end, so nothing is written;
 * 'refused' when the figures are not finite and the write must not happen. An audio clip that
 * requires the source trim is not planned here.
 */
export function planStartTrim(
    context: Clip,
    newStartBeat: number,
    anchorBeat: number | null | undefined,
    restoredMidiOffsetBeats: number | undefined
): StartTrimPlan | 'refused' | null {
    if (!(newStartBeat < context.endBeat)) {
        return null;
    }
    // Non-finite figures are corrupted data, dropped to the absent form (#5198, #5512).
    const restoreAnchorBeat = anchorBeat !== null && !Number.isFinite(anchorBeat) ? undefined : anchorBeat;
    const restoreMidiOffsetBeats =
        restoredMidiOffsetBeats !== undefined && !Number.isFinite(restoredMidiOffsetBeats)
            ? undefined
            : restoredMidiOffsetBeats;
    const startBeat = Math.max(0, newStartBeat);
    const updated = withTrimmedHead(context, startBeat, restoreAnchorBeat);
    if (context.type !== 'midi') {
        return { clip: updated, rowShiftBeats: null };
    }
    return planMidiOffset(context, updated, startBeat - context.startBeat, restoreMidiOffsetBeats);
}
