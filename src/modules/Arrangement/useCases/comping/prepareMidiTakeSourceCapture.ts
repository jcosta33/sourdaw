import { isFrozenMidiTakeSource } from '#/modules/MIDI/useCases';
import { type MidiClipDataActionSnapshot } from '#/utils/handlerContract';

import { type MidiTakeSource, type Take } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { resolveTakeMedia } from '../resolveTakeMedia';

type PrepareMidiTakeSourceCaptureInput = {
    readonly clip: Clip;
    readonly take: Take;
    readonly siblingTakes: readonly Take[];
    /** The split or Delete Time plan's exact pre-partition snapshot. */
    readonly rows: MidiClipDataActionSnapshot;
    readonly timeline: TempoTimeline;
};

/**
 * A finished loop pass spans the transport loop even when a first pass began
 * partway through it. The recording clip itself need not have clip looping on.
 */
function passLengthBeats(clip: Clip, take: Take, siblingTakes: readonly Take[]): number {
    if (clip.loopEnabled && clip.loopLength !== undefined) {
        return clip.loopLength;
    }
    if (take.sourceOffsetBeats === undefined) {
        return take.endBeat - take.startBeat;
    }
    const completed = siblingTakes.filter(
        (sibling) => sibling.clipId === take.clipId && sibling.sourceOffsetBeats !== undefined
    );
    return Math.max(take.endBeat - take.startBeat, ...completed.map((sibling) => sibling.endBeat - sibling.startBeat));
}

/** Capture a take's original MIDI rows and source interval before ordinary row partitioning. */
export function prepareMidiTakeSourceCapture({
    clip,
    take,
    siblingTakes,
    rows,
    timeline,
}: PrepareMidiTakeSourceCaptureInput): MidiTakeSource | null {
    if (clip.type !== 'midi' || take.clipId !== clip.id) {
        return null;
    }
    const span = take.endBeat - take.startBeat;
    const period = passLengthBeats(clip, take, siblingTakes);
    const media = resolveTakeMedia(take, clip, timeline);
    if (!media || !Number.isFinite(span) || span <= 0 || !Number.isFinite(period) || period <= 0) {
        return null;
    }
    const entry = media.offsetAt(take.startBeat);
    const source: MidiTakeSource = {
        sourceClipId: clip.id,
        rows: structuredClone(rows),
        sourceEntryBeat: entry,
        sourceEndBeat: entry + Math.min(span, period),
        phaseHeadBeat: take.startBeat,
        passLengthBeats: period,
    };
    return isFrozenMidiTakeSource(source) ? source : null;
}

/** Preserve source rows and move only their song-time phase with a re-keyed fragment. */
export function relocateMidiTakeSource(
    source: MidiTakeSource,
    preImageStartBeat: number,
    targetStartBeat: number
): MidiTakeSource | null {
    if (!isFrozenMidiTakeSource(source) || !Number.isFinite(preImageStartBeat) || !Number.isFinite(targetStartBeat)) {
        return null;
    }
    const moved = {
        ...source,
        phaseHeadBeat: source.phaseHeadBeat + targetStartBeat - preImageStartBeat,
    };
    return isFrozenMidiTakeSource(moved) ? moved : null;
}
