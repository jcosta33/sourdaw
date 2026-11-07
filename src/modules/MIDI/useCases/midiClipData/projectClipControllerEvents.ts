import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type MidiCC } from '../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';

import { projectMidiClipWindow } from './projectMidiClipWindow';

type ControllerProjectionClip = {
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    /**
     * The clip's loop anchor (#4988). The pass window stays anchored to the
     * source across start trims; absent, it reads from the offset exactly as
     * before the anchor existed.
     */
    loopOriginBeat?: number;
};

type ProjectClipControllerEventsInput = {
    controlChanges: readonly MidiCC[];
    clip: ControllerProjectionClip;
    /** The scheduling window `[fromBeat, toBeat)` on the timeline; a controller belongs to exactly one such window. */
    fromBeat: number;
    toBeat: number;
};

type IterationRange = { startIndex: number; endIndex: number };

/** A controller move a clip plays, at its absolute beat. */
export type ProjectedClipControllerMove = MidiCC & {
    /**
     * Whether the move is a pedal lift on the clip's closing line, at exactly
     * `clip.endBeat` — sustain only at value 0 (a continuous position, so a partial
     * value there is no lift), and the other switch controllers below the latch
     * threshold. Such a move is owned by the window `[fromBeat, toBeat)` with
     * `fromBeat < endBeat <= toBeat` (the last window the clip plays in). At its sample frame the
     * clip's moves apply, in the clip's own order, before the moves of a clip that starts there,
     * so the clip that follows has the last word.
     */
    closesClip: boolean;
};

/**
 * The loop passes the clip plays. A pass whose head sits within float noise of the
 * clip end is the rounding overshoot of `ceil(duration / length)`, not a pass: its
 * window would carry a held value onto the clip's closing line. A genuine short
 * final pass is longer than the tolerance and stays.
 */
function countPasses(
    clip: ControllerProjectionClip,
    expansion: { iterationCount: number; loopLengthBeats: number }
): number {
    if (!clip.loopEnabled || expansion.iterationCount === 0) {
        return Math.min(1, expansion.iterationCount);
    }
    const playedBeats = clip.endBeat - clip.startBeat - SAME_BEAT_TOLERANCE;
    const passesByHead = Math.max(1, Math.ceil(playedBeats / expansion.loopLengthBeats));
    return Math.min(expansion.iterationCount, passesByHead);
}

/**
 * The loop passes whose events can reach the window; a clip that does not loop has exactly one.
 * A pass head row lands within float noise of the pass head, either side of it, so the range
 * widens by the tolerance and the event's own beat decides which of two abutting windows owns it.
 */
function resolveIterationRange(
    clip: ControllerProjectionClip,
    expansion: { iterationCount: number; loopLengthBeats: number },
    window: { fromBeat: number; toBeat: number }
): IterationRange {
    const passCount = countPasses(clip, expansion);
    if (!clip.loopEnabled) {
        return { startIndex: 0, endIndex: passCount };
    }
    const startIndex = Math.max(
        0,
        Math.floor((window.fromBeat - clip.startBeat - SAME_BEAT_TOLERANCE) / expansion.loopLengthBeats)
    );
    const endIndex = Math.min(
        passCount,
        Math.ceil((window.toBeat - clip.startBeat + SAME_BEAT_TOLERANCE) / expansion.loopLengthBeats)
    );
    return { startIndex: Math.min(startIndex, endIndex), endIndex };
}

function ownsMove(move: ProjectedClipControllerMove, fromBeat: number, toBeat: number): boolean {
    if (move.closesClip) {
        return move.beat > fromBeat && move.beat <= toBeat;
    }
    return move.beat >= fromBeat && move.beat < toBeat;
}

/**
 * The controller moves a clip plays inside the timeline window `[fromBeat, toBeat)`,
 * at their absolute beats, in beat order.
 *
 * Each loop pass is projected through `projectMidiClipWindow` over the loop
 * region the clip was looped with, entered at the trim advance's phase — the
 * same anchored read the audio pass and the note readers use (#4988): the pass
 * head plays the region from its entry on, and the material before the entry
 * wraps onto the pass tail in a second window, so a move is placed exactly
 * where a note at that content beat is. A move past the region end sits in
 * neither window, so a trim can no longer leave it firing at the wrapped
 * head's phase. An unanchored clip — or a stale-anchored one with the loop
 * off, the anchor being inert there — advances zero, which puts the region at
 * the offset and the entry at its head: exactly the pre-anchor read, one
 * window per pass. Every window and the clip start begin from the value in
 * force at the span's head — the carry rule glue, export and split already
 * use — and a move is placed exactly where a note at that content beat is:
 * iteration start plus the beat past `midiOffsetBeats`. No groove applies to
 * a controller.
 *
 * The window is half-open like the note scheduler's, so a move is owned by one
 * window and a scheduler stepping `[a, b)`, `[b, c)` — or wrapping at a loop seam —
 * emits it once. A carried value sits on its pass head, so only the window holding
 * that head emits it: a window that opens mid-clip emits no carry. That is the
 * start-and-seek chase this projection leaves to the transport, but not the
 * relocation of playback already rolling (a loop wrap, a follow-action jump),
 * which the window cannot restore on its own: `projectClipControllerRestore`
 * names what a relocation must send, and the window that opens at the
 * destination still emits the rows sitting on it.
 *
 * A pedal lift on the clip's closing line plays at the
 * clip end, as the last thing the clip does, so a lift drawn on the final bar line ends
 * the sustain there before the next clip starts (Cubase's own reset events after a
 * recording sit on a part's end). A lift is sustain only at value 0 — sustain is a
 * continuous position, so a partial value there lifts nothing — and the other switch
 * controllers below the latch threshold. Any other row there stays dropped: a press would
 * hold past the clip end with nothing of the clip left to hold (a comp cut or a trim
 * landing on a press would leave the pedal down until stop), and a continuous
 * controller would set a value for whatever follows. Only the last pass has that line: an inner loop seam stays half-open, so a row on the
 * loop end is not replayed at every wrap, and notes keep the half-open end everywhere.
 * The move is placed at exactly `clip.endBeat` and owned by the window that closes at
 * or past it: the clip plays in that window and in no later one, so a window that
 * opens on the clip end, where the clip is not scheduled, owes it nothing.
 */
export function projectClipControllerEvents({
    controlChanges,
    clip,
    fromBeat,
    toBeat,
}: ProjectClipControllerEventsInput): ProjectedClipControllerMove[] {
    if (controlChanges.length === 0) {
        return [];
    }
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const { startIndex, endIndex } = resolveIterationRange(clip, expansion, { fromBeat, toBeat });
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    const lastPassIndex = countPasses(clip, expansion) - 1;
    // #4988 — the pass reads the loop region the clip was looped with,
    // cyclically, entering at the trim advance's phase: the content offset
    // names where the head enters, and a start trim advances only that entry,
    // so subtracting the advance from it recovers the region. An entry past
    // the pass head splits the pass into two contiguous windows — the region
    // from the entry on, then its wrapped head — each placed so a move lands
    // where a note at its content beat does. An unanchored clip advances
    // zero, which puts the region at the offset and the entry at its head:
    // exactly the pre-anchor read, one window per pass.
    const loopAdvanceBeats = resolveClipLoopOriginAdvance({
        startBeat: clip.startBeat,
        loopOriginBeat: clip.loopOriginBeat,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const regionStartBeat = midiOffsetBeats - loopAdvanceBeats;
    const regionEntryBeats =
        ((loopAdvanceBeats % expansion.loopLengthBeats) + expansion.loopLengthBeats) % expansion.loopLengthBeats;
    const events: ProjectedClipControllerMove[] = [];

    for (let iteration = startIndex; iteration < endIndex; iteration++) {
        const iterationStartBeat = clip.startBeat + iteration * expansion.loopLengthBeats;
        const iterationEndBeat = Math.min(iterationStartBeat + expansion.loopLengthBeats, clip.endBeat);
        const passSpanBeats = iterationEndBeat - iterationStartBeat;
        const headSegmentEndBeats = Math.min(passSpanBeats, expansion.loopLengthBeats - regionEntryBeats);
        const isClosingPass = iteration === lastPassIndex;
        // The closing line belongs to the pass's last segment: the wrapped
        // head window when the pass reaches it, the entry window otherwise.
        const hasWrappedSegment = regionEntryBeats > 0 && passSpanBeats > headSegmentEndBeats;
        const windows: {
            beatOffset: number;
            visibleStartBeat: number;
            visibleEndBeat: number;
            closingLineBeat?: number;
        }[] = [
            {
                beatOffset: iterationStartBeat - (regionStartBeat + regionEntryBeats),
                visibleStartBeat: regionStartBeat + regionEntryBeats,
                visibleEndBeat: regionStartBeat + regionEntryBeats + headSegmentEndBeats,
                closingLineBeat: isClosingPass && !hasWrappedSegment ? clip.endBeat : undefined,
            },
        ];
        if (hasWrappedSegment) {
            windows.push({
                beatOffset: iterationStartBeat + headSegmentEndBeats - regionStartBeat,
                visibleStartBeat: regionStartBeat,
                visibleEndBeat: regionStartBeat + (passSpanBeats - headSegmentEndBeats),
                closingLineBeat: isClosingPass ? clip.endBeat : undefined,
            });
        }
        for (const window of windows) {
            const projected = projectMidiClipWindow({
                notes: [],
                controlChanges,
                pitchBends: [],
                window,
            });
            const moves = [
                ...projected.controlChanges.map((event) => ({ ...event, closesClip: false })),
                ...projected.closingControlChanges.map((event) => ({ ...event, closesClip: true })),
            ];
            for (const move of moves) {
                if (ownsMove(move, fromBeat, toBeat)) {
                    events.push(move);
                }
            }
        }
    }

    return events.sort((left, right) => left.beat - right.beat);
}
