import { isAudioSourceSnapshot } from '#/utils/audioSourceTime';
import {
    type CompSelectionSpanSnapshot,
    type AppAction,
    type HandlerSessionActionEntry,
    type HandlerMaterializationContext,
    type HandlerValidationContext,
} from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { isValidCompAudioSourcePromotions } from '../../stores/compAudioSourcePromotions';
import { sanitizeTrackSnapshot } from '../../stores/trackStore';
import { type Clip } from '../../models/Track';
import { type CompAudioSourceInputContext } from '../../stores/compAudioSourceInputs';
import { decodeExactTakeLaneSnapshots, takeLaneStore } from '../../stores/takeLaneStore';
import {
    applyTakeLaneCompRegionPatch,
    captureCompSelection,
    runWithTakeLaneWriteIntent,
    type TakeLaneCompRegionPatch,
    type TakeLaneStoreValue,
} from '../../stores/takeLaneWriteJournal';

import { getTrackStoreState } from '../getTrackStoreState';
import { liveTempoTimeline } from '../liveTempoTimeline';
import { prepareCompAudioSourcePatch } from './prepareCompAudioSourcePatch';
import { liveCompAudioSourceInputs } from './liveCompAudioSourceInputs';
import { captureCompAudioSourceAuthorizations } from './captureCompAudioSourceAuthorizations';

import { takeLaneSelection } from './takeLaneSelection';

export type CompRegionIntervalPatch = TakeLaneCompRegionPatch;

function isValidInterval(startBeat: number, endBeat: number): boolean {
    return Number.isFinite(startBeat) && Number.isFinite(endBeat) && startBeat >= 0 && endBeat > startBeat;
}

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

function hasExactSpanKeys(span: object): boolean {
    const keys = Object.keys(span);
    return keys.every((key) => ['startBeat', 'endBeat', 'takeId', 'audioSource'].includes(key));
}

function isValidSelectionSpan(input: {
    readonly span: unknown;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly previousEnd: number;
    readonly previousTakeId: string | undefined;
    readonly previousAudioSource: CompSelectionSpanSnapshot['audioSource'];
}): input is typeof input & { readonly span: CompSelectionSpanSnapshot } {
    const { span, startBeat, endBeat, previousEnd, previousTakeId, previousAudioSource } = input;
    if (!span || typeof span !== 'object') {
        return false;
    }
    if (!('startBeat' in span) || !('endBeat' in span) || !('takeId' in span)) {
        return false;
    }
    if (typeof span.startBeat !== 'number' || typeof span.endBeat !== 'number' || typeof span.takeId !== 'string') {
        return false;
    }
    return (
        hasExactSpanKeys(span) &&
        (!('audioSource' in span) || isAudioSourceSnapshot(span.audioSource)) &&
        span.takeId.length > 0 &&
        Number.isFinite(span.startBeat) &&
        Number.isFinite(span.endBeat) &&
        span.startBeat >= startBeat &&
        span.endBeat <= endBeat &&
        span.startBeat < span.endBeat &&
        span.startBeat >= previousEnd &&
        !(
            span.startBeat === previousEnd &&
            span.takeId === previousTakeId &&
            valuesEqual('audioSource' in span ? span.audioSource : undefined, previousAudioSource)
        )
    );
}

function hasValidSnapshot(spans: readonly unknown[], startBeat: number, endBeat: number): boolean {
    let previousEnd = startBeat;
    let previousTakeId: string | undefined;
    let previousAudioSource: CompSelectionSpanSnapshot['audioSource'];
    for (const span of spans) {
        const input = { span, startBeat, endBeat, previousEnd, previousTakeId, previousAudioSource };
        if (!isValidSelectionSpan(input)) {
            return false;
        }
        previousEnd = input.span.endBeat;
        previousTakeId = input.span.takeId;
        previousAudioSource = input.span.audioSource;
    }
    return true;
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
    if (!sourcePlan || !Number.isFinite(input.startBeat) || input.startBeat < 0) return null;
    const lanes = state.lanes.filter((lane) => lane.trackId === input.trackId);
    const lane = lanes.length === 1 ? lanes[0] : undefined;
    const region = lane?.activeCompRegions.find((candidate) => candidate.startBeat === input.startBeat);
    if (!lane || !region || !lane.takes.some((take) => take.id === region.takeId)) return null;
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

function isCompleteCompRegionIntervalPatch(value: unknown): value is CompRegionIntervalPatch {
    if (!value || typeof value !== 'object') {
        return false;
    }
    if (
        !('laneId' in value) ||
        !('trackId' in value) ||
        !('startBeat' in value) ||
        !('endBeat' in value) ||
        !('expected' in value) ||
        !('replacement' in value)
    ) {
        return false;
    }
    const patch = value;
    const { startBeat, endBeat } = patch;
    if (typeof startBeat !== 'number' || typeof endBeat !== 'number') {
        return false;
    }
    return (
        typeof patch.laneId === 'string' &&
        patch.laneId.length > 0 &&
        typeof patch.trackId === 'string' &&
        patch.trackId.length > 0 &&
        typeof patch.startBeat === 'number' &&
        typeof patch.endBeat === 'number' &&
        isValidInterval(patch.startBeat, patch.endBeat) &&
        Array.isArray(patch.expected) &&
        Array.isArray(patch.replacement) &&
        hasValidSnapshot(patch.expected, patch.startBeat, patch.endBeat) &&
        hasValidSnapshot(patch.replacement, patch.startBeat, patch.endBeat) &&
        (!('audioSourcePromotions' in patch) ||
            isValidCompAudioSourcePromotions(patch.audioSourcePromotions, {
                startBeat: patch.startBeat,
                endBeat: patch.endBeat,
                takeIds: new Set(
                    [...patch.expected, ...patch.replacement].flatMap((span) =>
                        isRecord(span) && typeof span.takeId === 'string' ? [span.takeId] : []
                    )
                ),
                baseGapExposed: [patch.expected, patch.replacement].some(
                    (spans) =>
                        spans.reduce(
                            (length, span) =>
                                length +
                                (isRecord(span) &&
                                typeof span.startBeat === 'number' &&
                                typeof span.endBeat === 'number'
                                    ? span.endBeat - span.startBeat
                                    : 0),
                            0
                        ) <
                        endBeat - startBeat
                ),
            })) &&
        (!('baseGapAudioSourceFieldPresence' in patch) ||
            (patch.baseGapAudioSourceFieldPresence !== null &&
                typeof patch.baseGapAudioSourceFieldPresence === 'object' &&
                Object.keys(patch.baseGapAudioSourceFieldPresence).length === 2 &&
                'expected' in patch.baseGapAudioSourceFieldPresence &&
                typeof patch.baseGapAudioSourceFieldPresence.expected === 'boolean' &&
                'replacement' in patch.baseGapAudioSourceFieldPresence &&
                typeof patch.baseGapAudioSourceFieldPresence.replacement === 'boolean'))
    );
}

function isCompleteSetCompRegionPayload(
    value: unknown
): value is CompRegionIntervalPatch & { readonly takeId: string } {
    return (
        isCompleteCompRegionIntervalPatch(value) &&
        'takeId' in value &&
        typeof value.takeId === 'string' &&
        value.takeId.length > 0 &&
        value.replacement.length === 1 &&
        value.replacement[0]?.takeId === value.takeId &&
        value.replacement[0].startBeat === value.startBeat &&
        value.replacement[0].endBeat === value.endBeat &&
        Object.keys(value).every((key) =>
            [
                'laneId',
                'trackId',
                'startBeat',
                'endBeat',
                'takeId',
                'expected',
                'replacement',
                'audioSourcePromotions',
                'baseGapAudioSourceFieldPresence',
            ].includes(key)
        )
    );
}

function isCompleteRestoreCompRegionIntervalPayload(value: unknown): value is CompRegionIntervalPatch {
    return (
        isCompleteCompRegionIntervalPatch(value) &&
        Object.keys(value).every((key) =>
            [
                'laneId',
                'trackId',
                'startBeat',
                'endBeat',
                'expected',
                'replacement',
                'audioSourcePromotions',
                'baseGapAudioSourceFieldPresence',
            ].includes(key)
        )
    );
}

function isCompleteRemoveCompRegionPayload(value: unknown): value is CompRegionIntervalPatch {
    return (
        isCompleteRestoreCompRegionIntervalPayload(value) &&
        value.replacement.length === 0 &&
        value.expected.length === 1 &&
        value.expected[0]?.startBeat === value.startBeat &&
        value.expected[0]?.endBeat === value.endBeat
    );
}

type TakeLanePrefixContext = Pick<HandlerValidationContext, 'actions' | 'actionIndex'> | HandlerMaterializationContext;

type CompSourcePlan = { readonly clips: Clip[]; readonly inputs: CompAudioSourceInputContext };

/** Track lifecycle prefixes already carry the real owner snapshot. Read its
 * normalized source shape; do not reconstruct clip edits or a tempo clock. */
function sourceInputsAfterPrefix(
    trackId: string,
    context?: TakeLanePrefixContext,
    limit = context?.actionIndex ?? 0
): CompSourcePlan | null {
    const live = liveCompAudioSourceInputs();
    let tracks = [...(getTrackStoreState()?.tracks ?? [])];
    for (const action of context?.actions.slice(0, limit) ?? []) {
        if (action.type === 'removeTrack') tracks = tracks.filter((track) => track.id !== action.payload.trackId);
        if (action.type !== 'restoreTrack') continue;
        const snapshot: unknown = action.payload.trackSnapshot;
        if (!isRecord(snapshot) || !Array.isArray(snapshot.clips)) return null;
        const restored = sanitizeTrackSnapshot({ tracks: [snapshot], selectedTrackId: null }).tracks;
        if (
            restored.length !== 1 ||
            restored[0]!.id !== action.payload.trackId ||
            restored[0]!.clips.length !== snapshot.clips.length ||
            tracks.some((track) => track.id === action.payload.trackId)
        )
            return null;
        tracks = [...tracks, restored[0]!];
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

function projectTakeLaneStateThroughActionPrefix(
    initialState: TakeLaneStoreValue,
    context: TakeLanePrefixContext | undefined,
    mode: 'capture' | 'validate'
): TakeLaneStoreValue | null {
    if (!context) {
        return initialState;
    }
    let state = structuredClone(initialState);
    for (const [actionIndex, action] of context.actions.slice(0, context.actionIndex).entries()) {
        if (action.type === 'selectTake') {
            const selected = takeLaneSelection.apply(state, action);
            if (!selected) {
                return null;
            }
            state = selected;
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
            if (mode === 'capture')
                patch = captureRemovedCompRegionPatchFromState(
                    state,
                    action.payload,
                    sourceInputsAfterPrefix(action.payload.trackId, context, actionIndex)
                );
            else {
                if (!isCompleteRemoveCompRegionPayload(action.payload)) return null;
                patch = action.payload;
            }
        } else if (action.type === 'restoreCompRegionInterval') {
            if (!isCompleteRestoreCompRegionIntervalPayload(action.payload)) {
                return null;
            }
            patch = action.payload;
        } else {
            continue;
        }
        if (!patch) {
            return null;
        }
        const sourcePlan = sourceInputsAfterPrefix(patch.trackId, context, actionIndex);
        if (!sourcePlan) return null;
        const authorizations = captureCompAudioSourceAuthorizations(
            state,
            patch,
            sourcePlan.clips,
            liveTempoTimeline,
            sourcePlan.inputs
        );
        if (!authorizations) return null;
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
    if (!value || typeof value !== 'object' || visited.has(value)) return false;
    visited.add(value);
    if (Array.isArray(value)) return value.some((entry) => mentionsSourceOwner(entry, trackId, clipIds, visited));
    if ('trackId' in value && value.trackId === trackId) return true;
    if ('sourceTrackId' in value && value.sourceTrackId === trackId) return true;
    for (const [key, entry] of Object.entries(value)) {
        if (
            ['clipId', 'clipAId', 'clipBId', 'sourceClipId', 'targetClipId'].includes(key) &&
            typeof entry === 'string' &&
            clipIds.has(entry)
        )
            return true;
        if (key === 'clipIds' && Array.isArray(entry) && entry.some((id) => typeof id === 'string' && clipIds.has(id)))
            return true;
        if (mentionsSourceOwner(entry, trackId, clipIds, visited)) return true;
    }
    return false;
}

function supportsSourceCapturePrefix(trackId: string, context: TakeLanePrefixContext | undefined): boolean {
    if (!context) return true;
    const prefix = context.actions.slice(0, context.actionIndex);
    const sourcePlan = sourceInputsAfterPrefix(trackId, context);
    if (!sourcePlan) return false;
    const clips = sourcePlan.clips;
    const hasRestoredAudio = prefix.some(
        (action) =>
            action.type === 'restoreTrack' && action.payload.trackId === trackId && action.payload.trackKind === 'audio'
    );
    if (!clips.some((clip) => clip.type === 'audio') && !hasRestoredAudio) return true;
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
    return projected
        ? captureCompRegionIntervalPatchFromState(projected, input, sourceInputsAfterPrefix(input.trackId, context))
        : null;
}

function captureRemovedCompRegionPatchAfterPrefix(
    input: { readonly trackId: string; readonly startBeat: number },
    context?: HandlerMaterializationContext
): CompRegionIntervalPatch | null {
    const state = takeLaneStore.value;
    if (!state || !supportsSourceCapturePrefix(input.trackId, context)) return null;
    const projected = projectTakeLaneStateThroughActionPrefix(state, context, 'capture');
    return projected
        ? captureRemovedCompRegionPatchFromState(projected, input, sourceInputsAfterPrefix(input.trackId, context))
        : null;
}

function intervalTakeOwnersAreLive(
    state: TakeLaneStoreValue,
    patch: CompRegionIntervalPatch,
    context?: TakeLanePrefixContext
): boolean {
    const lane = state.lanes.find((candidate) => candidate.id === patch.laneId && candidate.trackId === patch.trackId);
    if (!lane) return false;
    const sourcePlan = sourceInputsAfterPrefix(patch.trackId, context);
    if (!sourcePlan) return false;
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
    if (!state || !sourcePlan || !intervalTakeOwnersAreLive(state, patch, context)) return false;
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
    if (!sourcePlan) return 'conflict';
    const sourceAuthorizations = captureCompAudioSourceAuthorizations(
        state,
        patch,
        sourcePlan.clips,
        liveTempoTimeline,
        sourcePlan.inputs
    );
    if (!sourceAuthorizations) return 'conflict';
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
    return {
        ...patch,
        expected: patch.replacement,
        replacement: patch.expected,
        ...(patch.audioSourcePromotions === undefined
            ? {}
            : {
                  audioSourcePromotions: patch.audioSourcePromotions.map((delta) => ({
                      sourceInputs: delta.sourceInputs,
                      expected: delta.replacement,
                      replacement: delta.expected,
                  })),
              }),
        ...(patch.baseGapAudioSourceFieldPresence === undefined
            ? {}
            : {
                  baseGapAudioSourceFieldPresence: {
                      expected: patch.baseGapAudioSourceFieldPresence.replacement,
                      replacement: patch.baseGapAudioSourceFieldPresence.expected,
                  },
              }),
    };
}
function patchFromSetPayload(
    payload: Extract<AppAction, { type: 'setCompRegion' }>['payload']
): CompRegionIntervalPatch | null {
    if (!isCompleteSetCompRegionPayload(payload)) return null;
    const { takeId: _takeId, ...patch } = payload;
    return patch;
}
function isCompRegionSessionEntry(entry: HandlerSessionActionEntry): boolean {
    if (
        (entry.action.type !== 'setCompRegion' && entry.action.type !== 'removeCompRegion') ||
        entry.inverseAction?.type !== 'restoreCompRegionInterval' ||
        entry.redoAction?.type !== 'restoreCompRegionInterval'
    )
        return false;
    const patch =
        entry.action.type === 'setCompRegion'
            ? patchFromSetPayload(entry.action.payload)
            : isCompleteRemoveCompRegionPayload(entry.action.payload)
              ? entry.action.payload
              : null;
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
