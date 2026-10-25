import { prepareMidiClipSplit } from '#/modules/MIDI/useCases';
import { restampLoopOriginEntry, shiftLoopOriginEntry } from '#/utils/clipLoopOrigin';
import { type ClipSplitActionSnapshot } from '#/utils/handlerContract';

import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type Clip } from '../../stores/trackStore';
import { snapToZeroCrossing } from '../timelineInteractions/snapToZeroCrossing';

import { consumedStretchFactor } from './consumedStretchFactor';
import { prepareClipSplitSatellites } from './splitClipSatellites';

type PrepareClipSplitInput = {
    clipId: string;
    splitBeat: number;
    rightClipId?: string;
    resolvedSplitBeat?: number;
    targetNoteIds?: readonly string[];
};

/**
 * The spread entry the right fragment writes for the loop anchor (#4988): the
 * MIDI fragment restamps at its own start, the audio fragment shifts by
 * `timelineSplitDelta - contentSplitDelta`, and an unanchored source keeps the
 * key absent.
 */
function fragmentLoopOriginEntry(
    clip: Clip,
    anchoredStartBeat: number,
    timelineSplitDelta: number,
    contentSplitDelta: number
): { loopOriginBeat: number } | Record<string, never> {
    if (clip.type === 'midi') {
        return restampLoopOriginEntry(clip, anchoredStartBeat);
    }
    return shiftLoopOriginEntry(clip, timelineSplitDelta - contentSplitDelta);
}

export function prepareClipSplit({
    clipId,
    splitBeat,
    rightClipId,
    resolvedSplitBeat,
    targetNoteIds,
}: PrepareClipSplitInput) {
    if (
        !Number.isFinite(splitBeat) ||
        (resolvedSplitBeat !== undefined && !Number.isFinite(resolvedSplitBeat)) ||
        (rightClipId !== undefined && rightClipId.trim().length === 0)
    ) {
        return null;
    }
    const resolution = resolveEligibleClipWriteTarget({ clipId });
    if (resolution.status !== 'eligible') {
        return null;
    }
    const state = getTrackState();
    const track = state?.tracks.find((candidate) => candidate.id === resolution.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    if (!state || !track || !clip || splitBeat <= clip.startBeat || splitBeat >= clip.endBeat) {
        return null;
    }
    const effectiveRightClipId = rightClipId ?? getNextClipId();
    const rightIdIsUsed = state.tracks.some(
        (candidate) =>
            candidate.clips.some((candidateClip) => candidateClip.id === effectiveRightClipId) ||
            candidate.alternatives.some((alternative) =>
                alternative.clips.some((candidateClip) => candidateClip.id === effectiveRightClipId)
            )
    );
    if (rightIdIsUsed) {
        return null;
    }

    const adjustedSplitBeat = resolvedSplitBeat ?? snapToZeroCrossing(clip, splitBeat);
    if (adjustedSplitBeat <= clip.startBeat || adjustedSplitBeat >= clip.endBeat) {
        return null;
    }
    const adjustedMediaSplit = adjustedSplitBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
    const midiPlan = prepareMidiClipSplit({
        sourceClipId: clipId,
        rightClipId: effectiveRightClipId,
        splitBeat: adjustedMediaSplit,
        splitNotes: clip.type === 'midi',
        targetNoteIds,
    });
    if (!midiPlan) {
        return null;
    }
    const timelineSplitDelta = adjustedSplitBeat - clip.startBeat;
    // The consumed content is what the runtimes play: 1x unless stretch is on,
    // the bounded ratio when it is — the shared law, not the raw stored ratio
    // (a mode-off clip ignores its dormant ratio; an out-of-range one clamps).
    const contentSplitDelta = timelineSplitDelta * consumedStretchFactor(clip);
    const contentSplitBeats = (clip.audioOffsetBeats ?? 0) + contentSplitDelta;

    const satellites = prepareClipSplitSatellites({
        clipId,
        rightClipId: effectiveRightClipId,
        clipRelativeSplitBeats: timelineSplitDelta,
        contentSplitBeats,
        absoluteSplitBeats: adjustedSplitBeat,
    });

    const leftClip: Clip = {
        ...clip,
        endBeat: adjustedSplitBeat,
        name: `${clip.name} (L)`,
        fadeOutBeats: 0,
    };
    // The right fragment's loop anchor follows its basis (#4988). The MIDI
    // fragment re-bases its notes (offset 0, notes shifted down by the split)
    // into a fresh media basis the source's timeline anchor has no meaning
    // in: carried through, the old anchor's advance opens the loop window
    // behind the fragment's head and silences surviving material, so it
    // restamps at the fragment's own start — key absent for an unanchored
    // source, the same law the delete/bounce fragment writers follow. The
    // audio fragment's media basis is preserved, and its offset advances by
    // the media delta `contentSplitDelta` — the stretched span the runtimes
    // actually played over the cut, not `timelineSplitDelta`. For the region
    // the audio readers recover —
    // `audioOffsetBeats - (startBeat - loopOriginBeat)` — to survive the
    // split, the carried anchor's advance (`startBeat - loopOriginBeat`)
    // must grow by that same media delta: shifted by
    // `timelineSplitDelta - contentSplitDelta`, the fragment's advance grows
    // to `(startBeat - loopOriginBeat) + contentSplitDelta`, which cancels
    // the offset's advance exactly at any stretch (the shift is zero at
    // stretch 1, so an unstretched split carries the anchor unchanged).
    // Carried unshifted, a stretched split displaces the region by
    // `timelineSplitDelta * (stretch - 1)` source beats and the fragment
    // enters on the wrong material at the cut.
    const rightLoopOriginEntry = fragmentLoopOriginEntry(
        clip,
        adjustedSplitBeat,
        timelineSplitDelta,
        contentSplitDelta
    );
    const rightClip: Clip = {
        ...clip,
        id: effectiveRightClipId,
        name: `${clip.name} (R)`,
        startBeat: adjustedSplitBeat,
        fadeInBeats: 0,
        audioOffsetBeats: contentSplitBeats,
        midiOffsetBeats: 0,
        ...rightLoopOriginEntry,
    };
    const previous: ClipSplitActionSnapshot = {
        trackId: track.id,
        leftClip: structuredClone(clip),
        rightClip: null,
        rightClipIndex: track.clips.length,
        sourceMidi: midiPlan.previousSource,
        rightMidi: midiPlan.previousRight,
        clipSatellites: satellites.previous,
        // The right clip id is proven unused, so the pre-split side carries no
        // lanes for it; the explicit emptiness is what the undo leg restores.
        clipAutomationLanes: [],
    };
    const next: ClipSplitActionSnapshot = {
        trackId: track.id,
        leftClip: structuredClone(leftClip),
        rightClip: structuredClone(rightClip),
        rightClipIndex: track.clips.length,
        sourceMidi: midiPlan.nextSource,
        rightMidi: midiPlan.nextRight,
        clipSatellites: satellites.next,
        clipAutomationLanes: satellites.rightAutomationLanes,
    };
    return {
        adjustedMediaSplit,
        previous,
        next,
        rightClipId: effectiveRightClipId,
        targetNoteIds: midiPlan.targetNoteIds,
    };
}
