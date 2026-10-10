import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext, type RetiredTakeLaneSnapshot } from '#/utils/handlerContract';

import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { applyPreparedClipSplit } from '../../useCases/clipEditing/applyPreparedClipSplit';
import { prepareClipSplit } from '../../useCases/clipEditing/prepareClipSplit';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { isSplitClipSessionEntry } from './validateClipEditSessionEntries';

type SplitClipAction = Extract<AppAction, { type: 'splitClip' }>;
type RestoreSplitAction = Extract<AppAction, { type: 'restoreClipSplitState' }>;
type Description = { label: string; inverseAction: RestoreSplitAction | null; redoAction?: RestoreSplitAction };
const pendingDescriptions = new WeakMap<SplitClipAction, Description>();

function prepareAction(action: SplitClipAction, context?: HandlerValidationContext) {
    const rightClipId = action.payload.rightClipId ?? getNextAppActionClipId();
    action.payload.rightClipId = rightClipId;
    const plan = prepareClipSplit({
        clipId: action.payload.clipId,
        splitBeat: action.payload.beat,
        rightClipId,
        resolvedSplitBeat: action.payload.resolvedBeat,
        targetNoteIds: action.payload.targetNoteIds,
        priorActions: context?.actions.slice(0, context.actionIndex),
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
            entry.redoAction.payload.retiredTakeLanes = entry.inverseAction.payload.retiredTakeLanes;
        }
        return true;
    },
    validate: (action, context) =>
        prepareClipSplit({
            clipId: action.payload.clipId,
            splitBeat: action.payload.beat,
            rightClipId: action.payload.rightClipId ?? '__split-preflight__',
            resolvedSplitBeat: action.payload.resolvedBeat,
            targetNoteIds: action.payload.targetNoteIds,
            priorActions: context.actions.slice(0, context.actionIndex),
        }) !== null,
    materializeCommandArguments: (action, context) => {
        prepareAction(action, context);
    },
    execute: (action) => {
        const pending = pendingDescriptions.get(action);
        try {
            const plan = prepareAction(action);
            if (!plan || !applyPreparedClipSplit(plan)) {
                if (pending) {
                    pending.inverseAction = null;
                    pending.redoAction = undefined;
                }
                return toHandlerExecutionResult(false);
            }
            if (pending) {
                const actual = describePlan(action, plan);
                if (pending.inverseAction && actual.inverseAction) {
                    Object.assign(pending.inverseAction.payload, actual.inverseAction.payload);
                }
                if (pending.redoAction && actual.redoAction) {
                    Object.assign(pending.redoAction.payload, actual.redoAction.payload);
                }
            }
            return toHandlerExecutionResult(true);
        } catch (error) {
            if (pending) {
                pending.inverseAction = null;
                pending.redoAction = undefined;
            }
            throw error;
        } finally {
            pendingDescriptions.delete(action);
        }
    },
    describe: (action, context) => {
        const plan = prepareAction(action, context);
        const description = plan ? describePlan(action, plan) : { label: 'Split clip', inverseAction: null };
        pendingDescriptions.set(action, description);
        return description;
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});

function describePlan(action: SplitClipAction, plan: NonNullable<ReturnType<typeof prepareClipSplit>>): Description {
    const actualBeat = plan.next.leftClip.endBeat;
    const label =
        actualBeat === action.payload.beat
            ? `Split clip "${plan.previous.leftClip.name}" (${action.payload.clipId}) at beat ${String(actualBeat)}`
            : `Split clip "${plan.previous.leftClip.name}" (${action.payload.clipId}) near requested beat ${String(action.payload.beat)} at beat ${String(actualBeat)}`;
    // Filled in place by the undo leg's `execute()` and read by the redo:
    // a take naming the right half can land after the split, so only the
    // undo can capture what filtering the right clip out retires.
    const retiredTakeLanes: RetiredTakeLaneSnapshot[] = [];
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
            },
        },
    };
}
