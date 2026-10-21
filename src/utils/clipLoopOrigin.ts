/**
 * The loop anchor a start trim must not move (#4988).
 *
 * A looped clip's content offset answers "where does the clip's head enter its
 * material", and a start trim advances it — that is the trim working. What the
 * trim must not do is move the loop region and the per-pass occurrence count
 * with it: per the convention trimming shows a different portion of the same
 * loop. `Clip.loopOriginBeat` carries the timeline beat the loop was
 * established at (loop enable, or the first trim of a clip born looped), and
 * every loop-window reader derives the trim's advance from it:
 *
 *     advanceBeats = clip.startBeat - (clip.loopOriginBeat ?? clip.startBeat)
 *
 * An absent field derives an advance of zero, which reproduces the
 * pre-anchor behavior exactly — legacy projects read as they always did.
 *
 * The anchor is inert while the loop is off (`setClipLoop` deliberately keeps
 * it for a later enable to restamp), so these readers treat it as absent
 * whenever `loopEnabled` is not true: a stale anchor from a past enable must
 * not wrap an unlooped clip's read at a boundary nothing loops on.
 */

import { projectClipLoopExpansion } from './clipLoopProjection';

export type ClipLoopOriginInput = Readonly<{
    startBeat: number;
    loopOriginBeat: number | undefined;
    /** The anchor reads only while the loop is on; otherwise it is absent. */
    loopEnabled: boolean;
}>;

/**
 * Whether the clip carries an anchor a reader may derive from. A non-finite
 * value is corruption, not an anchor: it can reach clip state through a store
 * updater, which — unlike `normalize_clip` — applies no finiteness guard, and
 * `startBeat - Infinity` would derive a `NaN` loop window whose segment
 * extents survive every `<= 0` death guard and reach `source.start()` as the
 * RangeError that kills a scheduler tick. Every reader degrades the same way
 * the CRDT normalizer does: the anchor is absent, the advance is zero.
 */
function isPresentLoopOriginBeat(loopOriginBeat: number | undefined): loopOriginBeat is number {
    return loopOriginBeat !== undefined && Number.isFinite(loopOriginBeat);
}

/** How far start trims have advanced this clip's head past its loop anchor. */
export function resolveClipLoopOriginAdvance({ startBeat, loopOriginBeat, loopEnabled }: ClipLoopOriginInput): number {
    if (loopEnabled !== true || !isPresentLoopOriginBeat(loopOriginBeat)) {
        return 0;
    }
    return startBeat - loopOriginBeat;
}

/**
 * The source-anchored start the occurrence index and comping resolvers stamp:
 * the anchor's start while the loop is on, the clip's own start otherwise —
 * the pre-anchor reading — so a stale anchor from a past enable never
 * re-rolls a de-looped clip's passes, and a non-finite one never stamps an
 * occurrence window measured from Infinity.
 */
export function resolveLoopAnchoredStartBeat({ startBeat, loopOriginBeat, loopEnabled }: ClipLoopOriginInput): number {
    return loopEnabled === true && isPresentLoopOriginBeat(loopOriginBeat) ? loopOriginBeat : startBeat;
}

type ClipLoopedOffsetInput = Readonly<{
    offsetBeats: number;
    loopEnabled: boolean;
    clipDurationBeats: number;
    configuredLoopLengthBeats: number | undefined;
}>;

/**
 * The content offset a looped clip stores: `offsetBeats` itself while the loop
 * is off, and its phase inside `[0, loopLength)` while the loop is on — the
 * same projection `projectClipLoopExpansion` gives the scheduling loop, so a
 * figure past the loop (a whole-loop advance, or a slip that crossed the
 * region end) stores as the equivalent phase instead of a raw figure the
 * loop-window readers would read one loop away from the material.
 *
 * Shared by every writer that re-bases a looped clip's content offset
 * (`trimClipStart`, `slipClipContent`) so the wrap cannot drift between them.
 */
export function resolveLoopedOffsetBeats({
    offsetBeats,
    loopEnabled,
    clipDurationBeats,
    configuredLoopLengthBeats,
}: ClipLoopedOffsetInput): number {
    if (!loopEnabled) {
        return offsetBeats;
    }
    const { loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats,
        configuredLoopLengthBeats,
        loopEnabled,
    });
    return ((offsetBeats % loopLengthBeats) + loopLengthBeats) % loopLengthBeats;
}

/**
 * The membership law for the readers that own candidates at absolute or
 * rack-owned coordinates — the Yeast chains, live and offline. The anchored
 * window when the clip carries one; unconditional admission otherwise. The
 * unanchored `isBeatInClipLoopWindow` fallback (`relative < loopLength`) is
 * deliberately NOT applied: these readers preselected their candidates by
 * scheduler window before the anchor existed, and grafting that fallback onto
 * them now would silently change loop-off and legacy-anchorless behavior the
 * anchor must never touch.
 */
export function isBeatAdmittedByAnchoredClipLoopWindow(input: ClipLoopWindowMembershipInput): boolean {
    if (input.loopEnabled !== true || !isPresentLoopOriginBeat(input.loopOriginBeat)) {
        return true;
    }
    return isBeatInClipLoopWindow(input);
}

type ClipLoopOriginShiftInput = Readonly<{
    loopOriginBeat?: number;
}>;

/**
 * The loop anchor after a whole-clip relocation by `deltaBeats` — a drag,
 * nudge, ripple shift, time-operation shift, or a duplicate or paste placed
 * elsewhere. A relocation changes neither the content offset nor the loop
 * phase, so the anchor rides the same delta and the advance
 * (`startBeat - loopOriginBeat`) — the loop window and the per-pass occurrence
 * count with it — is preserved exactly. A clip with no anchor stays
 * unanchored, which reads as an advance of zero.
 */
export function shiftLoopOrigin({ loopOriginBeat }: ClipLoopOriginShiftInput, deltaBeats: number): number | undefined {
    return loopOriginBeat === undefined ? undefined : loopOriginBeat + deltaBeats;
}

/**
 * The spread entry a clip writer emits for a resolved anchor value. A clip with
 * no anchor stays unanchored by leaving the key absent, never by writing it
 * `undefined`: clip objects carry optional fields either present or absent (the
 * CRDT normalizer rebuilds them that way), and the global time operations
 * compare their inverse plans' clip snapshots structurally against the
 * normalized live state, so an explicit-undefined key could never match the
 * state it was captured from — and is rejected outright by the codec's plan
 * encode, silently refusing the whole operation.
 */
export function loopOriginEntry(
    loopOriginBeat: number | undefined
): { loopOriginBeat: number } | Record<string, never> {
    return loopOriginBeat === undefined ? {} : { loopOriginBeat };
}

/**
 * The spread entry a whole-clip relocation writes for the loop anchor.
 */
export function shiftLoopOriginEntry(
    clip: ClipLoopOriginShiftInput,
    deltaBeats: number
): { loopOriginBeat: number } | Record<string, never> {
    return loopOriginEntry(shiftLoopOrigin(clip, deltaBeats));
}

/**
 * The spread entry a fragment writer emits after re-basing its clip's notes —
 * a split fragment that rewrites `midiOffsetBeats` to 0 and re-bases the notes
 * it keeps lives in a fresh coordinate basis the source's anchor has no
 * meaning in: carried through, the old anchor derives a spurious advance
 * whose window silences the surviving material. The anchor that reads the
 * fresh basis correctly is the fragment's own start — advance zero, the loop
 * window opening at the head, exactly what the pre-anchor reading admits — so
 * an anchored source re-stamps there, and a source with no anchor keeps the
 * key absent (the entry law above).
 */
export function restampLoopOriginEntry(
    clip: ClipLoopOriginShiftInput,
    anchoredStartBeat: number
): { loopOriginBeat: number } | Record<string, never> {
    return loopOriginEntry(clip.loopOriginBeat === undefined ? undefined : anchoredStartBeat);
}

/**
 * Beats closer than this are one instant — the same tolerance
 * `src/modules/MIDI/models/SameBeatTolerance.ts` gives the loop, groove, and
 * export machinery (`src/utils` never imports domain modules, so the value is
 * restated here). Projected beats on non-dyadic grids miss the exact figure by
 * about 1e-16 per beat, six orders below any length a musician places.
 */
export const CLIP_LOOP_WINDOW_BEAT_TOLERANCE = 1e-9;

type ClipLoopWindowMembershipInput = Readonly<{
    /**
     * The candidate's position in the coordinate the loop window reads. Every
     * gate paired with a projection reads the figure that projection windows
     * on: the synth chain grooves first (`getGrooveProjection`'s order law),
     * so its gates pass the committed-grooved content start minus
     * `midiOffsetBeats`; the rack chains admit stored rows before their own
     * groove phase and pass `note.startBeat - midiOffsetBeats`.
     */
    relativeBeat: number;
    startBeat: number;
    loopOriginBeat: number | undefined;
    loopLengthBeats: number;
    /** The anchor reads only while the loop is on; otherwise it is absent. */
    loopEnabled: boolean;
}>;

/**
 * Whether a candidate sits inside a looped clip's loop window.
 *
 * The pre-anchor law admitted everything below the loop length — a one-sided
 * bound whose ceiling slid right with every trim, admitting material the loop
 * never covered. The anchored law is the half-open region the clip was looped
 * with, carried backwards by the trim advance in the offset-relative
 * coordinate: `[−advance, loopLength − advance)`. Notes at or past the region
 * end stay out of every pass however far the clip is trimmed. Boundary reads
 * carry `CLIP_LOOP_WINDOW_BEAT_TOLERANCE` because the two coordinate chains
 * behind the comparison can disagree by an ulp; the tolerance keeps that drift
 * from flipping admission.
 *
 * Without an anchor — absent, or present-but-stale while the loop is off —
 * the window falls back to the pre-anchor law.
 */
export function isBeatInClipLoopWindow({
    relativeBeat,
    startBeat,
    loopOriginBeat,
    loopLengthBeats,
    loopEnabled,
}: ClipLoopWindowMembershipInput): boolean {
    if (!isPresentLoopOriginBeat(loopOriginBeat) || loopEnabled !== true) {
        return relativeBeat < loopLengthBeats;
    }
    const windowFloorBeat = -resolveClipLoopOriginAdvance({ startBeat, loopOriginBeat, loopEnabled });
    // The stored note figure (`note.startBeat - midiOffsetBeats`) and the
    // window bounds (`startBeat - loopOriginBeat`) descend from different
    // rounding chains — the offset wraps through `loopedMidiOffsetBeats`'
    // positive modulo while `shiftNotesWithOffsetWrap` shifts stored notes by
    // `wrapped - raw` — so a boundary note can land an ulp on the wrong side
    // of a strict comparison (#5198: a triplet-grid trim chain admitted the
    // loop-end note a second time, a deep trim silenced the loop head). The
    // exact predicate is
    // `relativeBeat >= windowFloorBeat - CLIP_LOOP_WINDOW_BEAT_TOLERANCE &&
    // relativeBeat < windowFloorBeat + loopLengthBeats - CLIP_LOOP_WINDOW_BEAT_TOLERANCE`:
    // the inclusive floor also admits within tolerance below it, and the
    // exclusive ceiling also excludes within tolerance below it, so drift
    // lands on the musical side — the head sounds, the region end never
    // doubles.
    return (
        relativeBeat >= windowFloorBeat - CLIP_LOOP_WINDOW_BEAT_TOLERANCE &&
        relativeBeat < windowFloorBeat + loopLengthBeats - CLIP_LOOP_WINDOW_BEAT_TOLERANCE
    );
}
