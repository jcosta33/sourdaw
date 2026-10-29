import { commandSourcePublicationMatches } from '#/modules/CrdtDocument/useCases';
import {
    type ClipSplitActionSnapshot,
    type ClipStateSnapshot,
    type TakeReKeyLaneTransitionSnapshot,
} from '#/utils/handlerContract';

const CLIP_SPLIT_SOURCE_KIND = 'clipSplitSource';

const sourceFields = [
    'id',
    'trackId',
    'type',
    'startBeat',
    'endBeat',
    'audioBufferId',
    'fileId',
    'assetHash',
    'audioOffsetBeats',
    'midiOffsetBeats',
    'audioOffsetSeconds',
    'audioUnwrappedOffsetSeconds',
    'audioLoopStartSeconds',
    'audioLoopPassEntrySeconds',
    'audioLoopPassOriginBeat',
    'loopEnabled',
    'loopLength',
    'loopOriginBeat',
    'stretchMode',
    'stretchRatio',
    'parentClipId',
    'isLinkedInstance',
] as const;

function clipSplitSourceFields(clip: ClipStateSnapshot | Readonly<Record<string, unknown>>) {
    return Object.fromEntries(sourceFields.filter((key) => clip[key] !== undefined).map((key) => [key, clip[key]]));
}

function clipSplitTakeSourceFields(
    take: Readonly<Record<string, unknown>> | TakeReKeyLaneTransitionSnapshot['takesBefore'][number]
) {
    const fields = [
        'id',
        'clipId',
        'startBeat',
        'endBeat',
        'sourceOffsetBeats',
        'sourceOffsetSeconds',
        'passAnchorSeconds',
        'passDepthSeconds',
        'passSourceEndSeconds',
        'passOriginBeat',
        'passOriginSourceSeconds',
    ] as const;
    return Object.fromEntries(fields.filter((key) => take[key] !== undefined).map((key) => [key, take[key]]));
}

/** JSON drops unset optionals and the sign of zero. Selection and later insertion witnesses are not source authority. */
function clipSplitSourceJson(value: unknown): unknown {
    if (typeof value === 'number' && Object.is(value, -0)) {
        return 0;
    }
    if (Array.isArray(value)) {
        return Array.from(value).map(clipSplitSourceJson);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key, field]) => key !== 'selected' && field !== undefined)
                .map(([key, field]) => [key, clipSplitSourceJson(field)])
        );
    }
    return value;
}

function clipSplitSourceProjection(
    undoEntryId: string,
    whole: ClipSplitActionSnapshot,
    split: ClipSplitActionSnapshot,
    transitions: readonly TakeReKeyLaneTransitionSnapshot[]
) {
    return clipSplitSourceJson({
        undoEntryId,
        trackId: whole.trackId,
        clipId: whole.leftClip.id,
        rightClipId: split.rightClip?.id,
        cut: split.leftClip.endBeat,
        originalTempo: whole.audioSourceTempoAtStart,
        producedTempo: split.audioSourceTempoAtStart,
        original: clipSplitSourceFields(whole.leftClip),
        left: clipSplitSourceFields(split.leftClip),
        right: split.rightClip ? clipSplitSourceFields(split.rightClip) : null,
        // These are the forward re-key's immutable before/after basis, not the
        // late right-side retirement capture that Undo refreshes independently.
        transitions: transitions.map((transition) => ({
            laneId: transition.laneId,
            trackId: transition.trackId,
            takesBefore: transition.takesBefore.map(clipSplitTakeSourceFields),
            takesAfter: transition.takesAfter.map(clipSplitTakeSourceFields),
            regionsBefore: transition.regionsBefore,
            regionsAfter: transition.regionsAfter,
            baseGapAudioSourcesBefore: transition.baseGapAudioSourcesBefore,
            baseGapAudioSourcesAfter: transition.baseGapAudioSourcesAfter,
        })),
    });
}

function clipSplitSourceMatches(
    undoEntryId: string | undefined,
    whole: ClipSplitActionSnapshot,
    split: ClipSplitActionSnapshot,
    transitions: readonly TakeReKeyLaneTransitionSnapshot[],
    reference: unknown
): boolean {
    return (
        undoEntryId !== undefined &&
        commandSourcePublicationMatches(
            CLIP_SPLIT_SOURCE_KIND,
            clipSplitSourceProjection(undoEntryId, whole, split, transitions),
            reference
        )
    );
}

export const clipSplitSource = {
    kind: CLIP_SPLIT_SOURCE_KIND,
    fields: clipSplitSourceFields,
    takeFields: clipSplitTakeSourceFields,
    json: clipSplitSourceJson,
    projection: clipSplitSourceProjection,
    matches: clipSplitSourceMatches,
};
