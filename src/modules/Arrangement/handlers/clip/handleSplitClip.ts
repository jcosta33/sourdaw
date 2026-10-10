import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type RetiredTakeLaneSnapshot,
    type TakeReKeyLaneTransitionSnapshot,
} from '#/utils/handlerContract';

import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { prepareClipSplit } from '../../useCases/clipEditing/prepareClipSplit';
import { splitClip } from '../../useCases/clipEditing/splitClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type SplitClipAction = Extract<AppAction, { type: 'splitClip' }>;

type PendingSplitDescription = {
    /**
     * The re-key capture the forward `execute()` fills in place (#5048) — read
     * back into the inverse/redo payloads, which share the same array.
     */
    reKeyedTakeLanes: TakeReKeyLaneTransitionSnapshot[];
};

// Keyed by action so concurrent splits cannot cross, mirroring the Delete Time
// handler: `execute()` mutates the very array `describe()` already put on the
// undo entry, which is how `executeAppAction` — reading the description only
// after execution completes — ends up with the real capture.
const pendingDescriptions = new WeakMap<object, PendingSplitDescription>();

function prepareAction(action: SplitClipAction) {
    const rightClipId = action.payload.rightClipId ?? getNextAppActionClipId();
    action.payload.rightClipId = rightClipId;
    const plan = prepareClipSplit({
        clipId: action.payload.clipId,
        splitBeat: action.payload.beat,
        rightClipId,
        resolvedSplitBeat: action.payload.resolvedBeat,
        targetNoteIds: action.payload.targetNoteIds,
    });
    if (plan && action.payload.targetNoteIds === undefined) {
        action.payload.targetNoteIds = plan.targetNoteIds;
    }
    if (plan && action.payload.resolvedBeat === undefined) {
        action.payload.resolvedBeat = plan.next.leftClip.endBeat;
    }
    return plan;
}

export const handleSplitClip = createHandler<'splitClip'>({
    validate: (action) =>
        prepareClipSplit({
            clipId: action.payload.clipId,
            splitBeat: action.payload.beat,
            rightClipId: action.payload.rightClipId ?? '__split-preflight__',
            resolvedSplitBeat: action.payload.resolvedBeat,
            targetNoteIds: action.payload.targetNoteIds,
        }) !== null,
    materializeCommandArguments: (action) => {
        prepareAction(action);
    },
    execute: (action) => {
        return toHandlerExecutionResult(
            splitClip(
                action.payload.clipId,
                action.payload.beat,
                action.payload.rightClipId,
                action.payload.targetNoteIds,
                action.payload.resolvedBeat,
                // The capture rides the shared array `describe()` put on both
                // undo payloads; without it the split still re-keys lanes, the
                // entry just cannot replay the re-key on undo/redo.
                { reKeyedTakeLanes: pendingDescriptions.get(action)?.reKeyedTakeLanes }
            ) !== null
        );
    },
    describe: (action) => {
        const plan = prepareAction(action);
        if (!plan) {
            return { label: 'Split clip', inverseAction: null };
        }
        const actualBeat = plan.next.leftClip.endBeat;
        const label =
            actualBeat === action.payload.beat
                ? `Split clip "${plan.previous.leftClip.name}" (${action.payload.clipId}) at beat ${String(actualBeat)}`
                : `Split clip "${plan.previous.leftClip.name}" (${action.payload.clipId}) near requested beat ${String(action.payload.beat)} at beat ${String(actualBeat)}`;
        // Filled in place by the undo leg's `execute()` and read by the redo:
        // a take naming the right half can land after the split, so only the
        // undo can capture what filtering the right clip out retires.
        const retiredTakeLanes: RetiredTakeLaneSnapshot[] = [];
        // Filled in place by the forward `execute()` and read by both legs: the
        // split's inverse is a snapshot restore, so only this capture carries
        // the pre-split take/comp-region facets the undo must put back (#5048).
        const reKeyedTakeLanes: TakeReKeyLaneTransitionSnapshot[] = [];
        pendingDescriptions.set(action, { reKeyedTakeLanes });
        return {
            label,
            inverseAction: {
                type: 'restoreClipSplitState',
                payload: {
                    clipId: action.payload.clipId,
                    rightClipId: plan.rightClipId,
                    expected: plan.next,
                    replacement: plan.previous,
                    retiredTakeLanes,
                    reKeyedTakeLanes,
                },
            },
            redoAction: {
                type: 'restoreClipSplitState',
                payload: {
                    clipId: action.payload.clipId,
                    rightClipId: plan.rightClipId,
                    expected: plan.previous,
                    replacement: plan.next,
                    retiredTakeLanes,
                    reKeyedTakeLanes,
                },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
