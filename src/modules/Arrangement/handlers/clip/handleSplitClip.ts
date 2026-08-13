import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { prepareClipSplit } from '../../useCases/clipEditing/prepareClipSplit';
import { splitClip } from '../../useCases/clipEditing/splitClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type SplitClipAction = Extract<AppAction, { type: 'splitClip' }>;

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
                action.payload.resolvedBeat
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
        return {
            label,
            inverseAction: {
                type: 'restoreClipSplitState',
                payload: {
                    clipId: action.payload.clipId,
                    rightClipId: plan.rightClipId,
                    expected: plan.next,
                    replacement: plan.previous,
                },
            },
            redoAction: {
                type: 'restoreClipSplitState',
                payload: {
                    clipId: action.payload.clipId,
                    rightClipId: plan.rightClipId,
                    expected: plan.previous,
                    replacement: plan.next,
                },
            },
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
