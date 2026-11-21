import {
    type AppAction,
    type HandlerSessionActionEntry,
    type HandlerMaterializationContext,
    type HandlerValidationContext,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompSelectionSpanSnapshot } from '../../events/arrangementTakeAppActions';
import { compSourceChange } from '../../models/ChangesCompSourceByActionType';
import { changesTempo } from '../../models/ChangesTempoByActionType';
import { takeLaneStore } from '../../stores/takeLaneStore';
import {
    applyTakeLaneCompRegionPatch,
    runWithTakeLaneWriteIntent,
    type TakeLaneCompRegionPatch,
    type TakeLaneStoreValue,
} from '../../stores/takeLaneWriteJournal';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { captureCompAudioSourceAuthorizations } from './captureCompAudioSourceAuthorizations';
import { compRegionPatchFromState, type CompRegionInput } from './captureCompRegionPatchFromState';
import { compRegionIntervalValidation } from './compRegionIntervalValidation';
import { sourceInputsAfterPrefix, type TakeLanePrefixContext } from './compSourcePlan';
import { projectTakeLaneStateThroughActionPrefix } from './projectTakeLaneStateThroughActionPrefix';

const { captureCompRegionIntervalPatchFromState, captureRemovedCompRegionPatchFromState } = compRegionPatchFromState;

const {
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

/** A track lifecycle action carries the whole track snapshot, which the source-track prefix applies directly. */
function leavesSourceOwnerAlone(action: AppAction, trackId: string, clipIds: ReadonlySet<string>): boolean {
    const change = compSourceChange(action.type);
    if (change === false || change === 'track-lifecycle') {
        return true;
    }
    return action.payload !== undefined && !mentionsSourceOwner(action.payload, trackId, clipIds);
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
    return prefix.every((action) => !changesTempo(action.type) && leavesSourceOwnerAlone(action, trackId, ids));
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
