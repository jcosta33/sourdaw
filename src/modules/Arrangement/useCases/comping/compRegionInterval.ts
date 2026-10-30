import {
    type CompSelectionSpanSnapshot,
    type AppAction,
    type HandlerSessionActionEntry,
    type HandlerMaterializationContext,
    type HandlerValidationContext,
} from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type Clip, type Track } from '../../models/Track';
import { type CompAudioSourceInputContext } from '../../stores/compAudioSourceInputs';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import {
    applyTakeLaneCompRegionPatch,
    captureCompSelection,
    runWithTakeLaneWriteIntent,
    type TakeLaneCompRegionPatch,
    type TakeLaneStoreValue,
} from '../../stores/takeLaneWriteJournal';
import { sanitizeTrackSnapshot } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';
import { liveTempoTimeline } from '../liveTempoTimeline';

import {
    captureOriginalMidiTakeRowCopies,
    prepareOriginalMidiTakeRowReplacement,
} from './prepareOriginalMidiTakeRowReplacement';
import { captureCompAudioSourceAuthorizations } from './captureCompAudioSourceAuthorizations';
import { compRegionIntervalValidation } from './compRegionIntervalValidation';
import { liveCompAudioSourceInputs } from './liveCompAudioSourceInputs';
import { prepareCompAudioSourcePatch } from './prepareCompAudioSourcePatch';
import { takeLaneSelection } from './takeLaneSelection';

const {
    isValidInterval,
    hasValidSnapshot,
    isCompleteSetCompRegionPayload,
    isCompleteRemoveCompRegionPayload,
    isCompleteRestoreCompRegionIntervalPayload,
} = compRegionIntervalValidation;

export type CompRegionIntervalPatch = TakeLaneCompRegionPatch;

function selectionsEqual(
    alpha: readonly CompSelectionSpanSnapshot[],
    beta: readonly CompSelectionSpanSnapshot[]
): boolean {
    return (
        alpha.length === beta.length &&
        alpha.every(
            (span, index) =>
                span.startBeat === beta[index]?.startBeat &&
                span.endBeat === beta[index]?.endBeat &&
                span.takeId === beta[index]?.takeId &&
                valuesEqual(span.audioSource, beta[index]?.audioSource)
        )
    );
}

type CompRegionInput = {
    readonly trackId: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly takeId: string;
};

function captureCompRegionIntervalPatchFromState(
    state: TakeLaneStoreValue,
    input: CompRegionInput,
    sourcePlan = sourceInputsAfterPrefix(input.trackId)
): CompRegionIntervalPatch | null {
    if (!sourcePlan || !isValidInterval(input.startBeat, input.endBeat)) {
        return null;
    }
    const matches = state.lanes.filter((lane) => lane.trackId === input.trackId);
    const lane = matches.length === 1 ? matches[0] : undefined;
    if (!lane || !lane.takes.some((take) => take.id === input.takeId)) {
        return null;
    }
    return prepareCompAudioSourcePatch(
        state,
        {
            laneId: lane.id,
            trackId: input.trackId,
            startBeat: input.startBeat,
            endBeat: input.endBeat,
            expected: captureCompSelection(lane.activeCompRegions, input.startBeat, input.endBeat),
            replacement: [{ startBeat: input.startBeat, endBeat: input.endBeat, takeId: input.takeId }],
        },
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
}

function captureRemovedCompRegionPatchFromState(
    state: TakeLaneStoreValue,
    input: { readonly trackId: string; readonly startBeat: number },
    sourcePlan = sourceInputsAfterPrefix(input.trackId)
): CompRegionIntervalPatch | null {
    if (!sourcePlan || !Number.isFinite(input.startBeat) || input.startBeat < 0) {
        return null;
    }
    const lanes = state.lanes.filter((lane) => lane.trackId === input.trackId);
    const lane = lanes.length === 1 ? lanes[0] : undefined;
    const region = lane?.activeCompRegions.find((candidate) => candidate.startBeat === input.startBeat);
    if (!lane || !region || !lane.takes.some((take) => take.id === region.takeId)) {
        return null;
    }
    return prepareCompAudioSourcePatch(
        state,
        {
            laneId: lane.id,
            trackId: lane.trackId,
            startBeat: region.startBeat,
            endBeat: region.endBeat,
            expected: captureCompSelection(lane.activeCompRegions, region.startBeat, region.endBeat),
            replacement: [],
        },
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
}

function captureRemovedCompRegionPatch(input: {
    readonly trackId: string;
    readonly startBeat: number;
}): CompRegionIntervalPatch | null {
    const state = takeLaneStore.value;
    return state ? captureRemovedCompRegionPatchFromState(state, input) : null;
}

function captureCompRegionIntervalPatch(input: CompRegionInput): CompRegionIntervalPatch | null {
    const state = takeLaneStore.value;
    return state ? captureCompRegionIntervalPatchFromState(state, input) : null;
}

type TakeLanePrefixContext = HandlerMaterializationContext;

type CompSourcePlan = { readonly clips: Clip[]; readonly inputs: CompAudioSourceInputContext };

function appendRestoredTrack(tracks: Track[], action: Extract<AppAction, { type: 'restoreTrack' }>): Track[] | null {
    const snapshot: unknown = action.payload.trackSnapshot;
    if (!isRecord(snapshot) || !Array.isArray(snapshot.clips)) {
        return null;
    }
    const restored = sanitizeTrackSnapshot({ tracks: [snapshot], selectedTrackId: null }).tracks;
    if (
        restored.length !== 1 ||
        restored[0]!.id !== action.payload.trackId ||
        restored[0]!.clips.length !== snapshot.clips.length ||
        tracks.some((track) => track.id === action.payload.trackId)
    ) {
        return null;
    }
    return [...tracks, restored[0]!];
}

/** Track lifecycle prefixes already carry the real owner snapshot. Read its
 * normalized source shape; do not reconstruct clip edits or a tempo clock. */
function sourceInputsAfterPrefix(
    trackId: string,
    context?: TakeLanePrefixContext,
    limit = context?.actionIndex ?? 0
): CompSourcePlan | null {
    const live = liveCompAudioSourceInputs();
    const currentTracks = getTrackStoreState()?.tracks;
    let tracks: Track[] = [];
    if (currentTracks !== undefined && currentTracks !== null) {
        tracks = [...currentTracks];
    }
    for (const action of (context?.preparedPrefix ?? context?.actions)?.slice(0, limit) ?? []) {
        if (action.type === 'removeTrack') {
            tracks = tracks.filter((track) => track.id !== action.payload.trackId);
        }
        if (action.type !== 'restoreTrack') {
            continue;
        }
        const restored = appendRestoredTrack(tracks, action);
        if (!restored) {
            return null;
        }
        tracks = restored;
    }
    return {
        clips: tracks.find((track) => track.id === trackId)?.clips ?? [],
        inputs: { ...live, tracks: { tracks } },
    };
}

function canAppendRestoredLanes(state: TakeLaneStoreValue, restoredLanes: TakeLaneStoreValue['lanes']): boolean {
    const laneIds = new Set(state.lanes.map((lane) => lane.id));
    const trackIds = new Set(state.lanes.map((lane) => lane.trackId));
    for (const lane of restoredLanes) {
        if (laneIds.has(lane.id) || trackIds.has(lane.trackId)) {
            return false;
        }
        laneIds.add(lane.id);
        trackIds.add(lane.trackId);
    }
    return true;
}

function prefixCompPatch(
    state: TakeLaneStoreValue,
    action: AppAction,
    context: TakeLanePrefixContext,
    actionIndex: number,
    mode: 'capture' | 'validate'
): CompRegionIntervalPatch | null | undefined {
    let patch: CompRegionIntervalPatch | null;
    if (action.type === 'setCompRegion') {
        if (mode === 'capture') {
            patch = captureCompRegionIntervalPatchFromState(
                state,
                action.payload,
                sourceInputsAfterPrefix(action.payload.trackId, context, actionIndex)
            );
        } else {
            if (!isCompleteSetCompRegionPayload(action.payload)) {
                return null;
            }
            patch = action.payload;
        }
    } else if (action.type === 'removeCompRegion') {
        if (mode === 'capture') {
            patch = captureRemovedCompRegionPatchFromState(
                state,
                action.payload,
                sourceInputsAfterPrefix(action.payload.trackId, context, actionIndex)
            );
        } else {
            if (!isCompleteRemoveCompRegionPayload(action.payload)) {
                return null;
            }
            patch = action.payload;
        }
    } else if (action.type === 'restoreCompRegionInterval') {
        if (!isCompleteRestoreCompRegionIntervalPayload(action.payload)) {
            return null;
        }
        patch = action.payload;
    } else {
        return undefined;
    }
    return patch;
}

function projectTakeLaneStateThroughActionPrefix(
    initialState: TakeLaneStoreValue,
    context: TakeLanePrefixContext | undefined,
    mode: 'capture' | 'validate'
): TakeLaneStoreValue | null {
    if (!context) {
        return initialState;
    }
    let state = structuredClone(initialState);
    for (const [actionIndex, action] of (context.preparedPrefix ?? context.actions)
        .slice(0, context.actionIndex)
        .entries()) {
        if (action.type === 'selectTake') {
            const selected = takeLaneSelection.apply(state, action);
            if (!selected) {
                return null;
            }
            state = selected;
            continue;
        }
        if (action.type === 'replaceOriginalMidiTakeRow') {
            const copyScope =
                action.payload.copyScope === 'capture'
                    ? captureOriginalMidiTakeRowCopies(action.payload, state)
                    : action.payload.copyScope;
            const next = copyScope && prepareOriginalMidiTakeRowReplacement({ ...action.payload, copyScope }, state);
            if (!next) return null;
            state = next;
            continue;
        }
        if (action.type === 'removeTrack') {
            state = { lanes: state.lanes.filter((lane) => lane.trackId !== action.payload.trackId) };
            continue;
        }
        if (action.type === 'restoreTrack') {
            const restoredLanes = decodeExactTakeLaneSnapshots(action.payload.takeLaneSnapshots);
            if (!restoredLanes || !canAppendRestoredLanes(state, restoredLanes)) {
                return null;
            }
            state = { lanes: [...state.lanes, ...restoredLanes] };
            continue;
        }

        const patch = prefixCompPatch(state, action, context, actionIndex, mode);
        if (patch === undefined) {
            continue;
        }
        if (!patch) {
            return null;
        }
        const sourcePlan = sourceInputsAfterPrefix(patch.trackId, context, actionIndex);
        if (!sourcePlan) {
            return null;
        }
        const authorizations = captureCompAudioSourceAuthorizations(
            state,
            patch,
            sourcePlan.clips,
            liveTempoTimeline,
            sourcePlan.inputs
        );
        if (!authorizations) {
            return null;
        }
        const next = applyTakeLaneCompRegionPatch(state, patch, sourcePlan.inputs, authorizations);
        if (!next) {
            return null;
        }
        state = next;
    }
    return state;
}

const sourceChangingActions = new Set([
    'addClip',
    'moveClip',
    'restoreClipPlacement',
    'duplicateClip',
    'duplicateClipToNextBar',
    'removeClip',
    'restoreClip',
    'discardDuplicatedClip',
    'splitClip',
    'restoreClipSplitState',
    'trimClipStart',
    'trimClipEnd',
    'slipClipContent',
    'drawClip',
    'discardDrawnClip',
    'restoreDrawnClip',
    'duplicateClipAt',
    'moveClips',
    'restoreClipMoves',
    'cutClip',
    'pasteClip',
    'reverseClip',
    'restoreReversedClip',
    'glueClips',
    'restoreClipGlueState',
    'nudgeClip',
    'crossfadeClips',
    'restoreCrossfadeClips',
    'setClipLoop',
    'restoreClipLoop',
    'setClipLoopLength',
    'restoreClipLoopLength',
    'setClipStretchMode',
    'setClipStretchRatio',
    'restoreClipStretchState',
    'fitClipToBeats',
    'restoreClipFileId',
    'restoreTrackClipStates',
    'removeTrack',
    'restoreTrack',
    'flattenTrack',
    'bounceTrack',
    'freezeTrack',
    'unfreezeTrack',
    'detectTempo',
]);
const sourceClockActions = new Set([
    'setTempo',
    'addTempoChange',
    'updateTempoChange',
    'removeTempoChange',
    'restoreTempoMapState',
    'deleteTime',
    'insertTime',
    'duplicateTime',
    'restoreTimeOperationState',
]);

function mentionsSourceOwner(
    value: unknown,
    trackId: string,
    clipIds: ReadonlySet<string>,
    visited = new Set<object>()
): boolean {
    if (!value || typeof value !== 'object' || visited.has(value)) {
        return false;
    }
    visited.add(value);
    if (Array.isArray(value)) {
        return value.some((entry) => mentionsSourceOwner(entry, trackId, clipIds, visited));
    }
    if ('trackId' in value && value.trackId === trackId) {
        return true;
    }
    if ('sourceTrackId' in value && value.sourceTrackId === trackId) {
        return true;
    }
    for (const [key, entry] of Object.entries(value)) {
        if (
            ['clipId', 'clipAId', 'clipBId', 'sourceClipId', 'targetClipId'].includes(key) &&
            typeof entry === 'string' &&
            clipIds.has(entry)
        ) {
            return true;
        }
        if (
            key === 'clipIds' &&
            Array.isArray(entry) &&
            entry.some((id) => typeof id === 'string' && clipIds.has(id))
        ) {
            return true;
        }
        if (mentionsSourceOwner(entry, trackId, clipIds, visited)) {
            return true;
        }
    }
    return false;
}

function supportsSourceCapturePrefix(trackId: string, context: TakeLanePrefixContext | undefined): boolean {
    if (!context) {
        return true;
    }
    const prefix = (context.preparedPrefix ?? context.actions).slice(0, context.actionIndex);
    const sourcePlan = sourceInputsAfterPrefix(trackId, context);
    if (!sourcePlan) {
        return false;
    }
    const clips = sourcePlan.clips;
    const hasRestoredAudio = prefix.some(
        (action) =>
            action.type === 'restoreTrack' && action.payload.trackId === trackId && action.payload.trackKind === 'audio'
    );
    if (!clips.some((clip) => clip.type === 'audio') && !hasRestoredAudio) {
        return true;
    }
    const ids = new Set(clips.map((clip) => clip.id));
    // No clock is reconstructed from a geometry-only replay projection. Such
    // promotion-dependent combinations refuse before any command publishes.
    return prefix.every(
        (action) =>
            !sourceClockActions.has(action.type) &&
            (action.type === 'restoreTrack' ||
                action.type === 'removeTrack' ||
                !sourceChangingActions.has(action.type) ||
                (action.payload !== undefined && !mentionsSourceOwner(action.payload, trackId, ids)))
    );
}

function captureCompRegionIntervalPatchAfterPrefix(
    input: CompRegionInput,
    context?: HandlerMaterializationContext
): CompRegionIntervalPatch | null {
    const state = takeLaneStore.value;
    if (!state || !supportsSourceCapturePrefix(input.trackId, context)) {
        return null;
    }
    const projected = projectTakeLaneStateThroughActionPrefix(state, context, 'capture');
    if (!projected) {
        return null;
    }
    return captureCompRegionIntervalPatchFromState(projected, input, sourceInputsAfterPrefix(input.trackId, context));
}

function captureRemovedCompRegionPatchAfterPrefix(
    input: { readonly trackId: string; readonly startBeat: number },
    context?: HandlerMaterializationContext
): CompRegionIntervalPatch | null {
    const state = takeLaneStore.value;
    if (!state || !supportsSourceCapturePrefix(input.trackId, context)) {
        return null;
    }
    const projected = projectTakeLaneStateThroughActionPrefix(state, context, 'capture');
    if (!projected) {
        return null;
    }
    return captureRemovedCompRegionPatchFromState(projected, input, sourceInputsAfterPrefix(input.trackId, context));
}

function intervalTakeOwnersAreLive(
    state: TakeLaneStoreValue,
    patch: CompRegionIntervalPatch,
    context?: TakeLanePrefixContext
): boolean {
    const lane = state.lanes.find((candidate) => candidate.id === patch.laneId && candidate.trackId === patch.trackId);
    if (!lane) {
        return false;
    }
    const sourcePlan = sourceInputsAfterPrefix(patch.trackId, context);
    if (!sourcePlan) {
        return false;
    }
    return [...patch.expected, ...patch.replacement].every((span) => {
        const take = lane.takes.find((candidate) => candidate.id === span.takeId);
        return take !== undefined && sourcePlan.clips.some((clip) => clip.id === take.clipId);
    });
}

function projectStateThroughMaterializedActionPrefix(
    state: TakeLaneStoreValue,
    context?: TakeLanePrefixContext
): TakeLaneStoreValue | null {
    return projectTakeLaneStateThroughActionPrefix(state, context, 'validate');
}

function compRegionIntervalPatchApplies(patch: CompRegionIntervalPatch, context?: HandlerValidationContext): boolean {
    const authority = takeLaneStore.value;
    if (
        !authority ||
        !hasValidSnapshot(patch.expected, patch.startBeat, patch.endBeat) ||
        (patch.audioSourcePromotions?.length && !supportsSourceCapturePrefix(patch.trackId, context))
    ) {
        return false;
    }
    const state = projectTakeLaneStateThroughActionPrefix(authority, context, 'validate');
    const sourcePlan = sourceInputsAfterPrefix(patch.trackId, context);
    if (!state || !sourcePlan || !intervalTakeOwnersAreLive(state, patch, context)) {
        return false;
    }
    const authorizations = captureCompAudioSourceAuthorizations(
        state,
        patch,
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
    return (
        authorizations !== null &&
        applyTakeLaneCompRegionPatch(state, patch, sourcePlan.inputs, authorizations) !== null
    );
}

function compRegionIntervalPatchIsNoop(patch: CompRegionIntervalPatch): boolean {
    return selectionsEqual(patch.expected, patch.replacement) && compRegionIntervalPatchApplies(patch);
}

function applyCompRegionIntervalPatch(patch: CompRegionIntervalPatch): 'written' | 'no-write' | 'conflict' {
    const state = takeLaneStore.value;
    if (!state || !intervalTakeOwnersAreLive(state, patch)) {
        return 'conflict';
    }
    const sourcePlan = sourceInputsAfterPrefix(patch.trackId);
    if (!sourcePlan) {
        return 'conflict';
    }
    const sourceAuthorizations = captureCompAudioSourceAuthorizations(
        state,
        patch,
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
    if (!sourceAuthorizations) {
        return 'conflict';
    }
    const next = applyTakeLaneCompRegionPatch(state, patch, sourcePlan.inputs, sourceAuthorizations);
    if (!next) {
        return 'conflict';
    }
    if (selectionsEqual(patch.expected, patch.replacement)) {
        return 'no-write';
    }
    runWithTakeLaneWriteIntent({ kind: 'comp-region-interval', patch, sourceAuthorizations }, () => {
        takeLaneStore.set({ lanes: [...next.lanes] });
    });
    return 'written';
}

function reversePatch(patch: CompRegionIntervalPatch): CompRegionIntervalPatch {
    const reversed = {
        ...patch,
        expected: patch.replacement,
        replacement: patch.expected,
    };
    if (patch.audioSourcePromotions !== undefined) {
        reversed.audioSourcePromotions = patch.audioSourcePromotions.map((delta) => ({
            sourceInputs: delta.sourceInputs,
            expected: delta.replacement,
            replacement: delta.expected,
        }));
    }
    if (patch.baseGapAudioSourceFieldPresence !== undefined) {
        reversed.baseGapAudioSourceFieldPresence = {
            expected: patch.baseGapAudioSourceFieldPresence.replacement,
            replacement: patch.baseGapAudioSourceFieldPresence.expected,
        };
    }
    return reversed;
}
function patchFromSetPayload(
    payload: Extract<AppAction, { type: 'setCompRegion' }>['payload']
): CompRegionIntervalPatch | null {
    if (!isCompleteSetCompRegionPayload(payload)) {
        return null;
    }
    const { takeId: _takeId, ...patch } = payload;
    return patch;
}
function isCompRegionSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        (entry.action.type !== 'setCompRegion' && entry.action.type !== 'removeCompRegion') ||
        entry.inverseAction?.type !== 'restoreCompRegionInterval' ||
        entry.redoAction?.type !== 'restoreCompRegionInterval'
    ) {
        return false;
    }
    let patch: CompRegionIntervalPatch | null;
    if (entry.action.type === 'setCompRegion') {
        patch = patchFromSetPayload(entry.action.payload);
    } else if (isCompleteRemoveCompRegionPayload(entry.action.payload)) {
        patch = entry.action.payload;
    } else {
        patch = null;
    }
    return (
        patch !== null &&
        isCompleteRestoreCompRegionIntervalPayload(entry.inverseAction.payload) &&
        isCompleteRestoreCompRegionIntervalPayload(entry.redoAction.payload) &&
        valuesEqual(entry.inverseAction.payload, reversePatch(patch)) &&
        valuesEqual(entry.redoAction.payload, patch)
    );
}

export const compRegionInterval = {
    applyPatch: applyCompRegionIntervalPatch,
    captureRemovePatch: captureRemovedCompRegionPatch,
    captureRemovePatchAfterPrefix: captureRemovedCompRegionPatchAfterPrefix,
    isCompleteRemovePayload: isCompleteRemoveCompRegionPayload,
    reversePatch,
    isSessionEntry: isCompRegionSessionEntry,
    capturePatch: captureCompRegionIntervalPatch,
    capturePatchAfterPrefix: captureCompRegionIntervalPatchAfterPrefix,
    isCompleteRestorePayload: isCompleteRestoreCompRegionIntervalPayload,
    isCompleteSetPayload: isCompleteSetCompRegionPayload,
    patchApplies: compRegionIntervalPatchApplies,
    patchIsNoop: compRegionIntervalPatchIsNoop,
    projectTakeLaneStateThroughMaterializedActionPrefix: projectStateThroughMaterializedActionPrefix,
};
