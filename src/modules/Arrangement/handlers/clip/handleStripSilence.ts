import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { prepareStripSilence } from '../../useCases/prepareStripSilence';
import { restoreStripSilenceState } from '../../useCases/restoreStripSilenceState';
import { stripSilence } from '../../useCases/stripSilence';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type StripSilenceAction = Extract<AppAction, { type: 'stripSilence' }>;

type StripSilencePlan = Pick<NonNullable<ReturnType<typeof prepareStripSilence>>, 'previous' | 'next'>;

type SuppliedPlanResolution = { status: 'planned'; plan: StripSilencePlan } | { status: 'refused' };

type StripSilencePlanResolution = SuppliedPlanResolution | { status: 'unplannable' };

const STALE_PLAN_REASON = 'The strip silence this command recorded no longer matches the project';

function carriesPlan(payload: StripSilenceAction['payload']): boolean {
    return payload.expected !== undefined || payload.replacement !== undefined;
}

/**
 * A strip carrying its plan (a compiled command, or an action this handler already planned) keeps
 * it: planning again would draw new segment clip ids and new lane ids, so the arguments would no
 * longer match the command's digest and the committed segments would not be the ones its receipt
 * names. The plan is kept only while it is still exactly what this project yields for the recorded
 * ids; a stale, partial, or altered plan is refused, never replanned.
 */
function verifySuppliedPlan(payload: StripSilenceAction['payload']): SuppliedPlanResolution {
    const { clipId, threshold, minDuration, expected, replacement } = payload;
    if (expected === undefined || replacement === undefined) {
        return { status: 'refused' };
    }
    const replanned = prepareStripSilence({
        clipId,
        threshold,
        minDuration,
        segmentClipIds: replacement.clips.map((clip) => clip.id),
        automationLaneIds: replacement.clipAutomationLanes.map((lane) => lane.id),
    });
    if (!replanned || !jsonValuesEqual(replanned.previous, expected) || !jsonValuesEqual(replanned.next, replacement)) {
        return { status: 'refused' };
    }
    return { status: 'planned', plan: { previous: expected, next: replacement } };
}

function prepareAction(action: StripSilenceAction): StripSilencePlanResolution {
    if (carriesPlan(action.payload)) {
        return verifySuppliedPlan(action.payload);
    }
    const plan = prepareStripSilence({
        clipId: action.payload.clipId,
        threshold: action.payload.threshold,
        minDuration: action.payload.minDuration,
    });
    if (!plan) {
        return { status: 'unplannable' };
    }
    action.payload.expected = plan.previous;
    action.payload.replacement = plan.next;
    return { status: 'planned', plan };
}

export const handleStripSilence = createHandler<'stripSilence'>({
    materializeCommandArguments: (action) => {
        prepareAction(action);
    },
    execute: (action) => {
        if (!carriesPlan(action.payload)) {
            return toHandlerExecutionResult(
                stripSilence(action.payload.clipId, action.payload.threshold, action.payload.minDuration)
            );
        }
        const resolution = verifySuppliedPlan(action.payload);
        if (resolution.status === 'refused') {
            return { status: 'conflict', reason: STALE_PLAN_REASON };
        }
        return toHandlerExecutionResult(
            restoreStripSilenceState({ expected: resolution.plan.previous, replacement: resolution.plan.next })
        );
    },
    describe: (action) => {
        const resolution = prepareAction(action);
        if (resolution.status !== 'planned') {
            return { label: 'Strip silence', inverseAction: null };
        }
        const { plan } = resolution;
        return {
            label: 'Strip silence',
            inverseAction: {
                type: 'restoreStripSilenceState',
                payload: { expected: plan.next, replacement: plan.previous },
            },
            redoAction: {
                type: 'restoreStripSilenceState',
                payload: { expected: plan.previous, replacement: plan.next },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
