import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';

export type ControllerProjectionClip = {
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
};

/** One loop pass a controller-style lane is projected through, in the arguments `projectMidiClipWindow` takes. */
export type ClipControllerPass = {
    beatOffset: number;
    visibleStartBeat: number;
    visibleEndBeat: number;
    /** Set on the last pass only: the clip end, where a closing-line row plays. */
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
    const passes: ClipControllerPass[] = [];

    for (let iteration = startIndex; iteration < endIndex; iteration++) {
        const iterationStartBeat = clip.startBeat + iteration * expansion.loopLengthBeats;
        const iterationEndBeat = Math.min(iterationStartBeat + expansion.loopLengthBeats, clip.endBeat);
        passes.push({
            beatOffset: iterationStartBeat - midiOffsetBeats,
            visibleStartBeat: midiOffsetBeats,
            visibleEndBeat: midiOffsetBeats + (iterationEndBeat - iterationStartBeat),
            closingLineBeat: iteration === lastPassIndex ? clip.endBeat : undefined,
        });
    }
    return passes;
}
