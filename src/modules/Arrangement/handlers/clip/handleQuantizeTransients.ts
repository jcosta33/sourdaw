import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type HandlerValidationContext,
    type TransientQuantizePlanSnapshot,
} from '#/utils/handlerContract';

import { prepareTransientQuantize } from '../../useCases/prepareTransientQuantize';
import { restoreStripSilenceState } from '../../useCases/restoreStripSilenceState';
import { transientQuantizePlanIsCurrent } from '../../useCases/transientQuantizePlanIsCurrent';

import {
    isMaterializedQuantizeTransientsPayload,
    isQuantizeTransientsSessionEntry,
} from './validateClipReplacementSessionEntries';

type QuantizeTransientsAction = Extract<AppAction, { type: 'quantizeTransients' }>;

type PlanResolution =
    { status: 'planned'; plan: TransientQuantizePlanSnapshot } | { status: 'refused'; reason: string };

const LABEL = 'Quantize transients';
const STALE_PLAN_REASON = 'The transient quantize this command recorded no longer matches the project';
const PREFIX_REASON = 'Quantize transients must not follow an edit of its clip or the tempo map in the same batch';

/** Every action that rewrites the tempo map, which places every slice the plan computed. */
const TEMPO_MAP_WRITERS: ReadonlySet<AppAction['type']> = new Set([
    'setTempo',
    'restoreTempoEdit',
    'editTempoMap',
    'restoreTempoMapEdit',
    'detectTempo',
    'insertTime',
    'deleteTime',
    'duplicateTimeRange',
    'restoreTimeOperationState',
]);

/**
 * A carried plan (a compiled command, or one this handler already planned) is kept as it is: planning
 * again would detect again and draw fresh slice ids, so the committed slices would not be the ones the
 * command's digest and receipt name. A missing plan is planned once and recorded in the payload.
 */
function prepareAction(action: QuantizeTransientsAction): PlanResolution {
    if (action.payload.plan !== undefined) {
        return { status: 'planned', plan: action.payload.plan };
    }
    const { clipId, gridSize, strength, swing, sensitivity, minConfidence, startBeat, endBeat } = action.payload;
    const preparation = prepareTransientQuantize({
        clipId,
        gridSize,
        strength,
        swing,
        sensitivity,
        minConfidence,
        startBeat,
        endBeat,
    });
    if (preparation.status === 'planned') {
        action.payload.plan = preparation.plan;
    }
    return preparation;
}

/**
 * The plan reads the project as it stood before the batch, so a command earlier in the same batch
 * that touches this clip or the tempo map would leave it describing a project that no longer exists.
 */
function priorActionInvalidatesPlan(action: QuantizeTransientsAction, context: HandlerValidationContext): boolean {
    const clipReference = JSON.stringify(action.payload.clipId);
    return context.actions
        .slice(0, context.actionIndex)
        .some(
            (prior) =>
                TEMPO_MAP_WRITERS.has(prior.type) ||
                (prior.payload !== undefined && JSON.stringify(prior.payload).includes(clipReference))
        );
}

function refusalReason(action: QuantizeTransientsAction, context: HandlerValidationContext): string | null {
    if (priorActionInvalidatesPlan(action, context)) {
        return PREFIX_REASON;
    }
    const resolution = prepareAction(action);
    if (resolution.status === 'refused') {
        return resolution.reason;
    }
    return transientQuantizePlanIsCurrent(action.payload.clipId, resolution.plan) ? null : STALE_PLAN_REASON;
}

export const handleQuantizeTransients = createHandler<'quantizeTransients'>({
    validateSessionEntry: isQuantizeTransientsSessionEntry,
    validateMaterializedCommandArguments: isMaterializedQuantizeTransientsPayload,
    validate: (action, context) => refusalReason(action, context) === null,
    validationRefusalReason: refusalReason,
    materializeCommandArguments: (action) => {
        prepareAction(action);
    },
    execute: (action) => {
        const resolution = prepareAction(action);
        if (resolution.status === 'refused') {
            return { status: 'conflict', reason: resolution.reason };
        }
        const { plan } = resolution;
        if (!transientQuantizePlanIsCurrent(action.payload.clipId, plan)) {
            return { status: 'conflict', reason: STALE_PLAN_REASON };
        }
        if (!restoreStripSilenceState({ expected: plan.expected, replacement: plan.replacement })) {
            return { status: 'conflict', reason: STALE_PLAN_REASON };
        }
        return { status: 'written' };
    },
    describe: (action) => {
        const resolution = prepareAction(action);
        if (resolution.status !== 'planned') {
            return { label: LABEL, inverseAction: null };
        }
        const { plan } = resolution;
        return {
            label: LABEL,
            inverseAction: {
                type: 'restoreStripSilenceState',
                payload: { expected: plan.replacement, replacement: plan.expected },
            },
            redoAction: {
                type: 'restoreStripSilenceState',
                payload: { expected: plan.expected, replacement: plan.replacement },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
