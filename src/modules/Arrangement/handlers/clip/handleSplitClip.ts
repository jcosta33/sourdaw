import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type CommandSourceProof,
    type HandlerMaterializationContext,
    type HandlerValidationContext,
    type RetiredTakeLaneSnapshot,
    type TakeReKeyLaneTransitionSnapshot,
} from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';
import { type TempoSourceClock } from '#/utils/tempoSourceClock';

import { type ZeroCrossingPosition } from '../../services/snapSplitBeatToZeroCrossing';
import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { captureClipSplitSource } from '../../useCases/clipEditing/captureClipSplitSource';
import { prepareClipSplit } from '../../useCases/clipEditing/prepareClipSplit';
import { preparedClipSplits } from '../../useCases/clipEditing/preparedClipSplit';
import { projectClipReplayPrefix } from '../../useCases/clipEditing/projectClipReplayPrefix';
import { splitClip } from '../../useCases/clipEditing/splitClip';
import { reKeyedTakeLaneOwnersMatchStore } from '../../useCases/comping/reKeyedTakeLaneOwnersMatchStore';
import { resolveZeroCrossingPosition } from '../../useCases/timelineInteractions/snapToZeroCrossing';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { isSplitClipSessionEntry } from './validateClipEditSessionEntries';

type SplitClipAction = Extract<AppAction, { type: 'splitClip' }>;

type PendingSplitDescription = {
    /**
     * The re-key capture the forward `execute()` fills in place (#5048) — read
     * back into the inverse/redo payloads, which share the same array.
     */
    reKeyedTakeLanes: TakeReKeyLaneTransitionSnapshot[];
    splitSourceProof?: CommandSourceProof;
};

// Keyed by action so concurrent splits cannot cross, mirroring the Delete Time
// handler: `execute()` mutates the very array `describe()` already put on the
// undo entry, which is how `executeAppAction` — reading the description only
// after execution completes — ends up with the real capture.
const pendingDescriptions = new WeakMap<object, PendingSplitDescription>();
const preparedSourceClocks = new WeakMap<object, TempoSourceClock>();
const preparedSourceRoots = new WeakMap<object, string>();

function prepareAction(action: SplitClipAction, context?: HandlerMaterializationContext) {
    const captured = preparedClipSplits.get(action);
    if (captured) {
        return captured;
    }
    const rightClipId = action.payload.rightClipId ?? getNextAppActionClipId();
    action.payload.rightClipId = rightClipId;
    const prefix = projectClipReplayPrefix(context?.preparedPrefix ?? context?.actions.slice(0, context.actionIndex));
    if (!prefix?.tracks) {
        return null;
    }
    let admittedSplitPosition: ZeroCrossingPosition | undefined;
    if (action.payload.resolvedBeat === undefined) {
        const admission = projectClipReplayPrefix();
        const clip = prefix.tracks.flatMap((track) => track.clips).find((clip) => clip.id === action.payload.clipId);
        if (!admission || !clip) {
            return null;
        }
        const position = resolveZeroCrossingPosition(clip, action.payload.beat, admission.timeline);
        // A preceding tempo write changes source placement, not the admitted split geometry.
        admittedSplitPosition = valuesEqual(admission.clock, prefix.clock) ? position : { beat: position.beat };
    }
    const plan = prepareClipSplit({
        clipId: action.payload.clipId,
        splitBeat: action.payload.beat,
        rightClipId,
        resolvedSplitBeat: action.payload.resolvedBeat,
        admittedSplitPosition,
        targetNoteIds: action.payload.targetNoteIds,
        owners: {
            tracks: prefix.tracks,
            takeLanes: prefix.takeLanes,
            automationLanes: prefix.lanes,
            timeline: prefix.timeline,
        },
    });
    if (plan && action.payload.targetNoteIds === undefined) {
        action.payload.targetNoteIds = plan.targetNoteIds;
    }
    if (plan && action.payload.resolvedBeat === undefined) {
        action.payload.resolvedBeat = plan.next.leftClip.endBeat;
    }
    if (plan) {
        preparedClipSplits.set(action, structuredClone(plan));
        preparedSourceClocks.set(action, structuredClone(prefix.clock));
        preparedSourceRoots.set(action, captureProjectRootIdentity());
    }
    return plan;
}

function capturePreparedSplitSource(
    action: SplitClipAction,
    plan: ReturnType<typeof preparedClipSplits.get>,
    pending: PendingSplitDescription | undefined,
    context: HandlerValidationContext | undefined
) {
    const clock = preparedSourceClocks.get(action);
    const audio = plan?.previous.leftClip.type === 'audio';
    let source: ReturnType<typeof captureClipSplitSource> = null;
    if (
        audio &&
        clock &&
        preparedSourceRoots.get(action) === captureProjectRootIdentity() &&
        pending?.splitSourceProof
    ) {
        source = captureClipSplitSource(
            plan,
            clock,
            context?.undoEntryId,
            pending.splitSourceProof,
            context?.actions.slice(0, context.actionIndex) ?? []
        );
    }
    return source;
}

export const handleSplitClip = createHandler<'splitClip'>({
    validateSessionEntry: (entry) => {
        if (!isSplitClipSessionEntry(entry)) {
            return false;
        }
        // The undo leg fills this owner capture after a later take lands on the
        // right fragment. JSON separates the paired arrays, so restore their
        // shared identity after validating both captures before replay.
        if (
            entry.inverseAction?.type === 'restoreClipSplitState' &&
            entry.redoAction?.type === 'restoreClipSplitState'
        ) {
            const inverse = entry.inverseAction.payload;
            // Legacy history has no placement witness until a real Undo sees
            // the right fragment. Do not infer peers from its stale index.
            const order = inverse.expected.rightClipOrder ?? [];
            inverse.expected = { ...inverse.expected, rightClipOrder: order };
            inverse.replacement = { ...inverse.replacement, rightClipOrder: order };
            entry.redoAction.payload.expected = inverse.replacement;
            entry.redoAction.payload.replacement = inverse.expected;
            entry.redoAction.payload.retiredTakeLanes = entry.inverseAction.payload.retiredTakeLanes;
            entry.redoAction.payload.retiredTakeSourceProof = entry.inverseAction.payload.retiredTakeSourceProof;
            entry.redoAction.payload.reKeyedTakeLanes = entry.inverseAction.payload.reKeyedTakeLanes;
            if (inverse.splitSourceProof !== undefined) {
                entry.redoAction.payload.splitSourceProof = inverse.splitSourceProof;
            }
        }
        return true;
    },
    validate: (action, context) => {
        const plan = prepareAction(action, context);
        const prefix = projectClipReplayPrefix(context.actions.slice(0, context.actionIndex));
        if (!plan || !prefix?.tracks) {
            return false;
        }
        const owner = prefix.clips.find((candidate) => candidate.clip.id === action.payload.clipId);
        return (
            owner?.owningTrackId === plan.previous.trackId &&
            valuesEqual(owner.clip, plan.previous.leftClip) &&
            !prefix.clips.some((candidate) => candidate.clip.id === plan.rightClipId) &&
            reKeyedTakeLaneOwnersMatchStore(plan.takeReKeyTransitions ?? [], 'apply', [], prefix.takeLanes)
        );
    },
    materializeCommandArgumentsAt: 'admission',
    materializeCommandArguments: (action, context) => {
        prepareAction(action, context);
    },
    execute: (action, context) => {
        const plan = preparedClipSplits.get(action);
        const pending = pendingDescriptions.get(action);
        const audio = plan?.previous.leftClip.type === 'audio';
        const source = capturePreparedSplitSource(action, plan, pending, context);
        if (audio && !source) {
            return { status: 'conflict' };
        }
        try {
            const written =
                splitClip(
                    action.payload.clipId,
                    action.payload.beat,
                    action.payload.rightClipId,
                    action.payload.targetNoteIds,
                    action.payload.resolvedBeat,
                    { reKeyedTakeLanes: pending?.reKeyedTakeLanes, prepared: plan }
                ) !== null;
            if (!written || (source && !source.captureWrittenState())) {
                source?.validation.release();
                if (source) {
                    return { status: 'conflict' };
                }
                return toHandlerExecutionResult(written);
            }
            if (source) {
                return { status: 'written', commitValidation: source.validation };
            }
            return toHandlerExecutionResult(written);
        } catch (error) {
            source?.validation.release();
            throw error;
        }
    },
    describe: (action, context) => {
        const plan = prepareAction(action, context);
        if (!plan) {
            return { label: 'Split clip', inverseAction: null };
        }
        // History may refresh its own captures during replay. It never owns the
        // private admitted plan the forward source guard and execution consume.
        const snapshots = structuredClone({ previous: plan.previous, next: plan.next });
        const actualBeat = plan.next.leftClip.endBeat;
        const label =
            actualBeat === action.payload.beat
                ? `Split clip "${plan.previous.leftClip.name}" (${action.payload.clipId}) at beat ${String(actualBeat)}`
                : `Split clip "${plan.previous.leftClip.name}" (${action.payload.clipId}) near requested beat ${String(action.payload.beat)} at beat ${String(actualBeat)}`;
        // Filled in place by the undo leg's `execute()` and read by the redo:
        // a take naming the right half can land after the split, so only the
        // undo can capture what filtering the right clip out retires.
        const retiredTakeLanes: RetiredTakeLaneSnapshot[] = [];
        const retiredTakeSourceProof = { changeHash: '', memberId: '' };
        // Filled in place by the forward `execute()` and read by both legs: the
        // split's inverse is a snapshot restore, so only this capture carries
        // the pre-split take/comp-region facets the undo must put back (#5048).
        const reKeyedTakeLanes: TakeReKeyLaneTransitionSnapshot[] = [];
        const splitSourceProof = plan.previous.leftClip.type === 'audio' ? { changeHash: '', memberId: '' } : undefined;
        pendingDescriptions.set(action, { reKeyedTakeLanes, splitSourceProof });
        const inverseAction: Extract<AppAction, { type: 'restoreClipSplitState' }> = {
            type: 'restoreClipSplitState',
            payload: {
                clipId: action.payload.clipId,
                rightClipId: plan.rightClipId,
                expected: snapshots.next,
                replacement: snapshots.previous,
                retiredTakeLanes,
                retiredTakeSourceProof,
                reKeyedTakeLanes,
            },
        };
        const redoAction: Extract<AppAction, { type: 'restoreClipSplitState' }> = {
            type: 'restoreClipSplitState',
            payload: {
                clipId: action.payload.clipId,
                rightClipId: plan.rightClipId,
                expected: snapshots.previous,
                replacement: snapshots.next,
                retiredTakeLanes,
                retiredTakeSourceProof,
                reKeyedTakeLanes,
            },
        };
        if (splitSourceProof) {
            inverseAction.payload.splitSourceProof = splitSourceProof;
            redoAction.payload.splitSourceProof = splitSourceProof;
        }
        return { label, inverseAction, redoAction };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
