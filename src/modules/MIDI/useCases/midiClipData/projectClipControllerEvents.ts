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
};

type ProjectClipControllerEventsInput = {
    controlChanges: readonly MidiCC[];
    clip: ControllerProjectionClip;
    /** The scheduling window `[fromBeat, toBeat)` on the timeline; a controller belongs to exactly one such window. */
    fromBeat: number;
    toBeat: number;
};

type IterationRange = { startIndex: number; endIndex: number };

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

/**
 * The controller moves a clip plays inside the timeline window `[fromBeat, toBeat)`,
 * at their absolute beats, in beat order.
 *
 * Each loop pass is projected through `projectMidiClipWindow` over its own visible
 * span, so every pass and the clip start begin from the value in force at the
 * span's head — the carry rule glue, export and split already use — and a move is
 * placed exactly where a note at that content beat is: iteration start plus the
 * beat past `midiOffsetBeats`. No groove applies to a controller.
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
 */
export function projectClipControllerEvents({
    controlChanges,
    clip,
    fromBeat,
    toBeat,
}: ProjectClipControllerEventsInput): MidiCC[] {
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
    const events: MidiCC[] = [];

    for (let iteration = startIndex; iteration < endIndex; iteration++) {
        const iterationStartBeat = clip.startBeat + iteration * expansion.loopLengthBeats;
        const iterationEndBeat = Math.min(iterationStartBeat + expansion.loopLengthBeats, clip.endBeat);
        const projected = projectMidiClipWindow({
            notes: [],
            controlChanges,
            pitchBends: [],
            window: {
                beatOffset: iterationStartBeat - midiOffsetBeats,
                visibleStartBeat: midiOffsetBeats,
                visibleEndBeat: midiOffsetBeats + (iterationEndBeat - iterationStartBeat),
            },
        });
        for (const event of projected.controlChanges) {
            if (event.beat >= fromBeat && event.beat < toBeat) {
                events.push(event);
            }
        }
    }

    return events.sort((left, right) => left.beat - right.beat);
}
