import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { glueClips } from '../../useCases/clipEditing/glueClips';
import { prepareClipGlue } from '../../useCases/clipEditing/prepareClipGlue';
import { restoreClipGlueState } from '../../useCases/clipEditing/restoreClipGlueState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type GlueClipsAction = Extract<AppAction, { type: 'glueClips' }>;

type GluePlan = NonNullable<ReturnType<typeof prepareClipGlue>>;

type SuppliedPlanResolution = { status: 'planned'; plan: GluePlan } | { status: 'refused' };

type GluePlanResolution = SuppliedPlanResolution | { status: 'unplannable' };

const STALE_PLAN_REASON = 'The glue this command recorded no longer matches the project';

function carriesPlan(payload: GlueClipsAction['payload']): boolean {
    return payload.expected !== undefined || payload.replacement !== undefined;
}

/**
 * A glue carrying its plan (a compiled command, or an action this handler already planned) keeps
 * it: planning again would draw a new glued clip id and new lane ids, so the arguments would no
 * longer match the command's digest and the committed objects would not be the ones its receipt
 * names. The plan is kept only while it is still exactly what this project yields for the recorded
 * ids; a stale, partial, or altered plan is refused, never replanned.
 */
function verifySuppliedPlan(payload: GlueClipsAction['payload']): SuppliedPlanResolution {
    const { clipIds, targetClipId, expected, replacement } = payload;
    if (targetClipId === undefined || expected === undefined || replacement === undefined) {
        return { status: 'refused' };
    }
    const replanned = prepareClipGlue({
        clipIds,
        targetClipId,
        automationLaneIds: replacement.clipAutomationLanes.map((lane) => lane.id),
    });
    if (!replanned || !jsonValuesEqual(replanned.previous, expected) || !jsonValuesEqual(replanned.next, replacement)) {
        return { status: 'refused' };
    }
    return { status: 'planned', plan: { previous: expected, next: replacement, targetClipId } };
}

function prepareAction(action: GlueClipsAction): GluePlanResolution {
    if (carriesPlan(action.payload)) {
        return verifySuppliedPlan(action.payload);
    }
    const plan = prepareClipGlue({ clipIds: action.payload.clipIds, targetClipId: action.payload.targetClipId });
    if (!plan) {
        return { status: 'unplannable' };
    }
    action.payload.targetClipId = plan.targetClipId;
    action.payload.expected = plan.previous;
    action.payload.replacement = plan.next;
    return { status: 'planned', plan };
}

export const handleGlueClips = createHandler<'glueClips'>({
    materializeCommandArguments: (action) => {
        prepareAction(action);
    },
    execute: (action) => {
        if (!carriesPlan(action.payload)) {
            return toHandlerExecutionResult(glueClips(action.payload.clipIds, action.payload.targetClipId));
        }
        const resolution = verifySuppliedPlan(action.payload);
        if (resolution.status === 'refused') {
            return { status: 'conflict', reason: STALE_PLAN_REASON };
        }
        return toHandlerExecutionResult(
            restoreClipGlueState({ expected: resolution.plan.previous, replacement: resolution.plan.next })
        );
    },
    describe: (action) => {
        const resolution = prepareAction(action);
        if (resolution.status !== 'planned') {
            return { label: 'Glue clips', inverseAction: null };
        }
        const { plan } = resolution;
        return {
            label: 'Glue clips',
            inverseAction: {
                type: 'restoreClipGlueState',
                payload: { expected: plan.next, replacement: plan.previous },
            },
            redoAction: {
                type: 'restoreClipGlueState',
                payload: { expected: plan.previous, replacement: plan.next },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
