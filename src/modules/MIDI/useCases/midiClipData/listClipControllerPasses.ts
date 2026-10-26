import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';

export type ControllerProjectionClip = {
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

/** One loop pass a controller-style lane is projected through, in the arguments `projectMidiClipWindow` takes. */
export type ClipControllerPass = {
    beatOffset: number;
    visibleStartBeat: number;
    visibleEndBeat: number;
    /** Set on the last window of the last pass only: the clip end, where a closing-line row plays. */
    closingLineBeat: number | undefined;
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
 * The passes of a clip whose rows can reach the timeline window `[fromBeat, toBeat)`.
 * Every lane of stored controller data (controllers and pitch bend) is projected through the
 * same passes, so a row of either is placed where a note at that content beat is.
 */
export function listClipControllerPasses(
    clip: ControllerProjectionClip,
    window: { fromBeat: number; toBeat: number }
): ClipControllerPass[] {
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    const { startIndex, endIndex } = resolveIterationRange(clip, expansion, window);
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    const lastPassIndex = countPasses(clip, expansion) - 1;
    // #4988 — the pass reads the loop region the clip was looped with,
    // cyclically, entering at the trim advance's phase: the content offset
    // names where the head enters, and a start trim advances only that entry,
    // so subtracting the advance from it recovers the region. An entry past
    // the pass head splits the pass into two contiguous windows — the region
    // from the entry on, then its wrapped head — each placed so a row lands
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
    const passes: ClipControllerPass[] = [];

    for (let iteration = startIndex; iteration < endIndex; iteration++) {
        const iterationStartBeat = clip.startBeat + iteration * expansion.loopLengthBeats;
        const iterationEndBeat = Math.min(iterationStartBeat + expansion.loopLengthBeats, clip.endBeat);
        const passSpanBeats = iterationEndBeat - iterationStartBeat;
        const headSegmentEndBeats = Math.min(passSpanBeats, expansion.loopLengthBeats - regionEntryBeats);
        const isClosingPass = iteration === lastPassIndex;
        // The closing line belongs to the pass's last segment: the wrapped
        // head window when the pass reaches it, the entry window otherwise.
        const hasWrappedSegment = regionEntryBeats > 0 && passSpanBeats > headSegmentEndBeats;
        passes.push({
            beatOffset: iterationStartBeat - (regionStartBeat + regionEntryBeats),
            visibleStartBeat: regionStartBeat + regionEntryBeats,
            visibleEndBeat: regionStartBeat + regionEntryBeats + headSegmentEndBeats,
            closingLineBeat: isClosingPass && !hasWrappedSegment ? clip.endBeat : undefined,
        });
        if (hasWrappedSegment) {
            passes.push({
                beatOffset: iterationStartBeat + headSegmentEndBeats - regionStartBeat,
                visibleStartBeat: regionStartBeat,
                visibleEndBeat: regionStartBeat + (passSpanBeats - headSegmentEndBeats),
                closingLineBeat: isClosingPass ? clip.endBeat : undefined,
            });
        }
    }
    return passes;
}
