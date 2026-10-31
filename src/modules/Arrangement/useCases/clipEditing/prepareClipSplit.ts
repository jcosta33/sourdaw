import { prepareMidiClipSplit } from '#/modules/MIDI/useCases';
import { getAudioSourcePositionSeconds, resolveAudioSourceOffsetSeconds } from '#/utils/audioSourceTime';
import {
    type ClipAutomationLaneSnapshot,
    type ClipSplitActionSnapshot,
    type TakeReKeyLaneTransitionSnapshot,
} from '#/utils/handlerContract';

import { type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { type ZeroCrossingPosition } from '../../services/snapSplitBeatToZeroCrossing';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { type Clip, type Track } from '../../stores/trackStore';
import { captureClipSplitTakeReKeyTransitions } from '../comping/captureClipSplitTakeReKey';
import { liveTempoTimeline } from '../liveTempoTimeline';
import { resolveZeroCrossingPosition } from '../timelineInteractions/snapToZeroCrossing';

import { audioSourceAtBeat } from './audioSourceAtBeat';
import { consumedStretchFactor } from './consumedStretchFactor';
import { type PreparedClipSplit } from './preparedClipSplit';
import { projectClipSplitSourceWindow } from './projectClipSplitSourceWindow';
import { readClipSplitIdentityIds } from './readClipSplitIdentityIds';
import { prepareClipSplitSatellites } from './splitClipSatellites';

function snapshotTakeReKeyTransitions(
    transitions: ReturnType<typeof captureClipSplitTakeReKeyTransitions>
): readonly TakeReKeyLaneTransitionSnapshot[] {
    return transitions.map((transition) => {
        const { baseGapAudioSourcesBefore, baseGapAudioSourcesAfter, ...fields } = structuredClone(transition);
        const snapshot: TakeReKeyLaneTransitionSnapshot = {
            ...fields,
            takesBefore: Array.from(fields.takesBefore),
            takesAfter: Array.from(fields.takesAfter),
            regionsBefore: Array.from(fields.regionsBefore),
            regionsAfter: Array.from(fields.regionsAfter),
        };
        if (Object.hasOwn(transition, 'baseGapAudioSourcesBefore')) {
            if (baseGapAudioSourcesBefore) {
                snapshot.baseGapAudioSourcesBefore = Array.from(baseGapAudioSourcesBefore);
            } else {
                snapshot.baseGapAudioSourcesBefore = undefined;
            }
        }
        if (Object.hasOwn(transition, 'baseGapAudioSourcesAfter')) {
            if (baseGapAudioSourcesAfter) {
                snapshot.baseGapAudioSourcesAfter = Array.from(baseGapAudioSourcesAfter);
            } else {
                snapshot.baseGapAudioSourcesAfter = undefined;
            }
        }
        return snapshot;
    });
}

function withAudioSourceTempo(
    snapshot: Omit<ClipSplitActionSnapshot, 'audioSourceTempoAtStart'>,
    enabled: boolean,
    tempo: number
): ClipSplitActionSnapshot {
    if (!enabled) {
        return snapshot;
    }
    return { audioSourceTempoAtStart: tempo, ...snapshot };
}

type PrepareClipSplitInput = {
    clipId: string;
    splitBeat: number;
    rightClipId?: string;
    resolvedSplitBeat?: number;
    admittedSplitPosition?: ZeroCrossingPosition;
    targetNoteIds?: readonly string[];
    owners?: {
        readonly tracks: readonly Track[];
        readonly takeLanes: readonly TakeLane[];
        readonly automationLanes: readonly ClipAutomationLaneSnapshot[];
        readonly timeline: TempoTimeline;
    };
};

export function prepareClipSplit({
    clipId,
    splitBeat,
    rightClipId,
    resolvedSplitBeat,
    admittedSplitPosition,
    targetNoteIds,
    owners,
}: PrepareClipSplitInput): PreparedClipSplit | null {
    if (
        !Number.isFinite(splitBeat) ||
        (resolvedSplitBeat !== undefined && !Number.isFinite(resolvedSplitBeat)) ||
        (admittedSplitPosition !== undefined &&
            (!Number.isFinite(admittedSplitPosition.beat) ||
                (resolvedSplitBeat !== undefined && admittedSplitPosition.beat !== resolvedSplitBeat) ||
                (admittedSplitPosition.sourceSeconds !== undefined &&
                    (!Number.isFinite(admittedSplitPosition.sourceSeconds) ||
                        admittedSplitPosition.sourceSeconds < 0)))) ||
        (rightClipId !== undefined && rightClipId.trim().length === 0)
    ) {
        return null;
    }
    let resolution: ReturnType<typeof resolveEligibleClipWriteTarget>;
    if (owners) {
        resolution = resolveEligibleClipWriteTarget(
            { clipId },
            { tracks: Array.from(owners.tracks), selectedTrackId: null }
        );
    } else {
        resolution = resolveEligibleClipWriteTarget({ clipId });
    }
    if (resolution.status !== 'eligible') {
        return null;
    }
    const state = getTrackState();
    const tracks = owners?.tracks ?? state?.tracks;
    const track = tracks?.find((candidate) => candidate.id === resolution.trackId);
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    if (!tracks || !track || !clip || splitBeat <= clip.startBeat || splitBeat >= clip.endBeat) {
        return null;
    }
    const effectiveRightClipId = rightClipId ?? getNextClipId();
    const rightIdIsUsed = tracks.some(
        (candidate) =>
            candidate.clips.some((candidateClip) => candidateClip.id === effectiveRightClipId) ||
            candidate.alternatives.some((alternative) =>
                alternative.clips.some((candidateClip) => candidateClip.id === effectiveRightClipId)
            )
    );
    if (rightIdIsUsed) {
        return null;
    }

    const timeline = owners?.timeline ?? liveTempoTimeline;
    let splitPosition: ZeroCrossingPosition;
    if (admittedSplitPosition !== undefined) {
        splitPosition = admittedSplitPosition;
    } else if (resolvedSplitBeat === undefined) {
        splitPosition = resolveZeroCrossingPosition(clip, splitBeat, timeline);
    } else {
        splitPosition = { beat: resolvedSplitBeat };
    }
    const adjustedSplitBeat = splitPosition.beat;
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
    const capturesAudioSource = clip.type === 'audio';
    const audioSourceTempoAtStart = timeline.tempoAtBeat(clip.startBeat);
    const leftSource = capturesAudioSource ? audioSourceAtBeat(clip, clip.startBeat, timeline) : null;
    const rightSource = capturesAudioSource ? audioSourceAtBeat(clip, adjustedSplitBeat, timeline) : null;
    if (capturesAudioSource && (!leftSource || !rightSource)) {
        return null;
    }
    if (rightSource && splitPosition.sourceSeconds !== undefined) {
        rightSource.audioOffsetSeconds = splitPosition.sourceSeconds;
    }
    let contentSplitBeats = (clip.audioOffsetBeats ?? 0) + contentSplitDelta;
    if (capturesAudioSource) {
        const startTempo = timeline.tempoAtBeat(clip.startBeat);
        const linearSourceSeconds = getAudioSourcePositionSeconds(
            resolveAudioSourceOffsetSeconds(clip, startTempo),
            timeline.secondsAtBeat(adjustedSplitBeat) - timeline.secondsAtBeat(clip.startBeat),
            consumedStretchFactor(clip)
        );
        // Warp points partition in the original source-beat clock, before any loop reset.
        contentSplitBeats = (linearSourceSeconds * startTempo) / 60;
    }

    let reservedIdentityIds: ReadonlySet<string> | undefined;
    const rightClipOrder = [...track.clips.map((clip) => clip.id), effectiveRightClipId];
    const rightClipIndex = track.clips.length;
    if (owners) {
        reservedIdentityIds = readClipSplitIdentityIds(
            owners.automationLanes,
            tracks.flatMap((candidate) => candidate.clips)
        );
    }

    const satellites = prepareClipSplitSatellites({
        clipId,
        rightClipId: effectiveRightClipId,
        clipRelativeSplitBeats: timelineSplitDelta,
        contentSplitBeats,
        absoluteSplitBeats: adjustedSplitBeat,
        reservedIdentityIds,
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
    const rightClip: Clip = {
        ...clip,
        id: effectiveRightClipId,
        name: `${clip.name} (R)`,
        startBeat: adjustedSplitBeat,
        fadeInBeats: 0,
        ...projectClipSplitSourceWindow(clip, adjustedSplitBeat),
        audioOffsetBeats: contentSplitBeats,
    };
    if (capturesAudioSource) {
        Object.assign(leftClip, leftSource);
        Object.assign(rightClip, rightSource);
        if (clip.loopEnabled) {
            leftClip.loopOriginBeat = clip.loopOriginBeat ?? clip.startBeat;
            rightClip.loopOriginBeat = leftClip.loopOriginBeat;
        }
    }
    const previous: ClipSplitActionSnapshot = withAudioSourceTempo(
        {
            trackId: track.id,
            leftClip: structuredClone(clip),
            rightClip: null,
            rightClipIndex,
            rightClipOrder,
            sourceMidi: midiPlan.previousSource,
            rightMidi: midiPlan.previousRight,
            clipSatellites: satellites.previous,
            // The right clip id is proven unused, so the pre-split side carries no
            // lanes for it; the explicit emptiness is what the undo leg restores.
            clipAutomationLanes: [],
        },
        capturesAudioSource,
        audioSourceTempoAtStart
    );
    const next: ClipSplitActionSnapshot = withAudioSourceTempo(
        {
            trackId: track.id,
            leftClip: structuredClone(leftClip),
            rightClip: structuredClone(rightClip),
            rightClipIndex,
            rightClipOrder,
            sourceMidi: midiPlan.nextSource,
            rightMidi: midiPlan.nextRight,
            clipSatellites: satellites.next,
            clipAutomationLanes: satellites.rightAutomationLanes,
        },
        capturesAudioSource,
        audioSourceTempoAtStart
    );
    const prepared = {
        adjustedMediaSplit,
        previous,
        next,
        rightClipId: effectiveRightClipId,
        targetNoteIds: midiPlan.targetNoteIds,
    };
    if (capturesAudioSource) {
        return {
            ...prepared,
            takeReKeyTransitions: snapshotTakeReKeyTransitions(
                captureClipSplitTakeReKeyTransitions({
                    sourceClip: structuredClone(clip),
                    trackId: track.id,
                    clipId,
                    rightClipId: effectiveRightClipId,
                    splitBeat: adjustedSplitBeat,
                    clipStartBeat: clip.startBeat,
                    clipEndBeat: clip.endBeat,
                    lanes: owners?.takeLanes,
                    timeline,
                    sourceMidi: midiPlan.previousSource,
                })
            ),
        };
    }
    return prepared;
}
