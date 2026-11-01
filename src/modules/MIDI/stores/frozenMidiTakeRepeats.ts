import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type FrozenMidiTakeSource } from './isFrozenMidiTakeSource';

/**
 * The comp fragment a frozen take sounds through: the resolved clip live comp
 * playback reads the take's media with, its start, end and loop.
 */
export type FrozenMidiTakeFragment = {
    readonly startBeat: number;
    readonly endBeat: number;
    readonly loopEnabled?: boolean;
    readonly loopLength?: number;
};

export type FrozenMidiTakeRepeat = {
    readonly absoluteOccurrenceIndex: number;
    /** The fragment start plus whole loop lengths: where live restarts the fragment's loop. */
    readonly startBeat: number;
    /** The next repeat's start, or the fragment end. */
    readonly endBeat: number;
    /** Every source beat the repeat reads at its own phase maps through it: `sourceEntryBeat + beat - passHeadBeat`. */
    readonly passHeadBeat: number;
    /** The loop length, or the whole fragment when it does not loop. */
    readonly strideBeats: number;
    /** Whether the fragment loops, so the repeat folds the material before its read into its tail as live does. */
    readonly loops: boolean;
};

function fragmentLoop(fragment: FrozenMidiTakeFragment) {
    return projectClipLoopExpansion({
        clipDurationBeats: fragment.endBeat - fragment.startBeat,
        configuredLoopLengthBeats: fragment.loopLength,
        loopEnabled: fragment.loopEnabled ?? false,
    });
}

function repeatOf(
    source: FrozenMidiTakeSource,
    fragment: FrozenMidiTakeFragment,
    loopLengthBeats: number,
    absoluteOccurrenceIndex: number
): FrozenMidiTakeRepeat {
    const startBeat = fragment.startBeat + absoluteOccurrenceIndex * loopLengthBeats;
    return {
        absoluteOccurrenceIndex,
        startBeat,
        endBeat: Math.min(fragment.endBeat, startBeat + loopLengthBeats),
        passHeadBeat: source.phaseHeadBeat + absoluteOccurrenceIndex * loopLengthBeats,
        strideBeats: loopLengthBeats,
        loops: fragment.loopEnabled === true,
    };
}

/**
 * The repeats of a frozen take in its fragment, as live comp playback plays a
 * pass take's media: from the fragment start, reading the media at the
 * fragment start's own offset, restarting every loop length when the fragment
 * loops and reading straight through when it does not.
 */
export function frozenMidiTakeRepeat(
    source: FrozenMidiTakeSource,
    fragment: FrozenMidiTakeFragment,
    absoluteOccurrenceIndex: number
): FrozenMidiTakeRepeat {
    return repeatOf(source, fragment, fragmentLoop(fragment).loopLengthBeats, absoluteOccurrenceIndex);
}

/** Every repeat that ends after `fromBeat` and starts before `toBeat`, in order. */
export function frozenMidiTakeRepeats(
    source: FrozenMidiTakeSource,
    fragment: FrozenMidiTakeFragment,
    fromBeat: number,
    toBeat: number
): FrozenMidiTakeRepeat[] {
    const { iterationCount, loopLengthBeats } = fragmentLoop(fragment);
    const first = Math.max(0, Math.floor((fromBeat - fragment.startBeat) / loopLengthBeats));
    const last = Math.min(iterationCount, Math.ceil((toBeat - fragment.startBeat) / loopLengthBeats));
    const repeats: FrozenMidiTakeRepeat[] = [];
    for (let absoluteOccurrenceIndex = first; absoluteOccurrenceIndex < last; absoluteOccurrenceIndex++) {
        repeats.push(repeatOf(source, fragment, loopLengthBeats, absoluteOccurrenceIndex));
    }
    return repeats;
}

/** The repeat sounding at `beat`, or null outside the fragment. */
export function frozenMidiTakeRepeatAt(
    source: FrozenMidiTakeSource,
    fragment: FrozenMidiTakeFragment,
    beat: number
): FrozenMidiTakeRepeat | null {
    if (beat < fragment.startBeat || beat >= fragment.endBeat) {
        return null;
    }
    const { loopLengthBeats } = fragmentLoop(fragment);
    return repeatOf(source, fragment, loopLengthBeats, Math.floor((beat - fragment.startBeat) / loopLengthBeats));
}
