import { prepareMidiClipSplit } from '#/modules/MIDI/useCases';
import { type ClipSplitActionSnapshot } from '#/utils/handlerContract';

import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type Clip } from '../../stores/trackStore';
import { snapToZeroCrossing } from '../timelineInteractions/snapToZeroCrossing';

type PrepareClipSplitInput = {
    clipId: string;
    splitBeat: number;
    rightClipId?: string;
    resolvedSplitBeat?: number;
    targetNoteIds?: readonly string[];
};

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

    const leftClip: Clip = {
        ...clip,
        endBeat: adjustedSplitBeat,
        name: `${clip.name} (L)`,
        fadeOutBeats: 0,
    };
    const rightClip: Clip = {
        ...clip,
        id: effectiveRightClipId,
        name: `${clip.name} (R)`,
        startBeat: adjustedSplitBeat,
        fadeInBeats: 0,
        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (adjustedSplitBeat - clip.startBeat),
        midiOffsetBeats: 0,
    };
    const previous: ClipSplitActionSnapshot = {
        trackId: track.id,
        leftClip: structuredClone(clip),
        rightClip: null,
        rightClipIndex: track.clips.length,
        sourceMidi: midiPlan.previousSource,
        rightMidi: midiPlan.previousRight,
    };
    const next: ClipSplitActionSnapshot = {
        trackId: track.id,
        leftClip: structuredClone(leftClip),
        rightClip: structuredClone(rightClip),
        rightClipIndex: track.clips.length,
        sourceMidi: midiPlan.nextSource,
        rightMidi: midiPlan.nextRight,
    };
    return {
        adjustedMediaSplit,
        previous,
        next,
        rightClipId: effectiveRightClipId,
        targetNoteIds: midiPlan.targetNoteIds,
    };
}
