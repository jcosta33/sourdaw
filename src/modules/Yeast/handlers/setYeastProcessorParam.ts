import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type YeastProcessorInfo } from '../stores/yeastStore';
import { GROOVE_AMOUNT_PARAM, setYeastProcessorParam } from '../useCases/setYeastProcessorParam';
import { findLiveProcessor } from './rackState';

type ParamPayload = {
    processorId: string;
    paramId: string;
    value: number;
    expectedValue?: number;
};

function isGrooveAmount(processor: YeastProcessorInfo, paramId: string): boolean {
    return processor.type === 'groove' && paramId === GROOVE_AMOUNT_PARAM;
}

function liveParamValue(processor: YeastProcessorInfo, paramId: string): number | undefined {
    return processor.params?.[paramId];
}

/**
 * The parameter value as the batch's preceding same-key actions leave it. A
 * coalesced gesture replays its inverses as one batch, so a guard must read the
 * sequentially projected value, not the live pre-batch one — the same
 * projection prior siblings force out of `selectTake`.
 */
function plannedParamValue(
    liveValue: number | undefined,
    context: HandlerValidationContext,
    payload: ParamPayload
): number | undefined {
    let value = liveValue;
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.type !== 'setYeastProcessorParam') {
            continue;
        }
        if (action.payload.processorId !== payload.processorId || action.payload.paramId !== payload.paramId) {
            continue;
        }
        value = action.payload.value;
    }
    return value;
}

/** `undefined` carries no assertion — fresh user intent may write over any
 *  current value; a number expects itself. */
function valueMatchesExpected(expectedValue: number | undefined, currentValue: number | undefined): boolean {
    return expectedValue === undefined || expectedValue === currentValue;
}

export const handleSetYeastProcessorParam = createHandler<'setYeastProcessorParam'>({
    // Conflicts when the live parameter no longer matches `expectedValue`, or
    // the processor vanished. Per-key only: a peer editing another parameter of
    // this processor, or another processor entirely, never blocks the undo
    // (#2111). Proven by the `canReportConflict` registry honesty spec; undo
    // step-over (#2881) relies on it.
    canReportConflict: true,
    validate: (action, context) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (!processor) {
            return false;
        }
        // The groove amount is owned by `assignGrooveTemplate`, never by this
        // action — see the contract note on the payload.
        if (isGrooveAmount(processor, action.payload.paramId)) {
            return false;
        }
        return valueMatchesExpected(
            action.payload.expectedValue,
            plannedParamValue(liveParamValue(processor, action.payload.paramId), context, action.payload)
        );
    },
    execute: async (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (!processor) {
            return { status: 'conflict' };
        }
        if (isGrooveAmount(processor, action.payload.paramId)) {
            // Delegated at the call sites: the panel settles the groove-amount
            // knob straight into `assignGrooveTemplate`. Refusing as no-write
            // keeps any other dispatcher from double-recording the gesture.
            return { status: 'no-write' };
        }
        if (!valueMatchesExpected(action.payload.expectedValue, liveParamValue(processor, action.payload.paramId))) {
            return { status: 'conflict' };
        }
        // The use case writes the store before its first await, so the write
        // lands inside the dispatch's storage transaction; the awaited tail
        // only pushes the runtime projection to the worker.
        await setYeastProcessorParam(action.payload.processorId, action.payload.paramId, action.payload.value);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (!processor) {
            return false;
        }
        if (isGrooveAmount(processor, action.payload.paramId)) {
            return true;
        }
        return liveParamValue(processor, action.payload.paramId) === action.payload.value;
    },
    describe: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        const previousValue = processor ? liveParamValue(processor, action.payload.paramId) : undefined;
        return {
            label: 'Set Yeast parameter',
            // Restores the pre-gesture value; no inverse when the parameter was
            // unset before (there is no "clear parameter" action) or when the
            // request rewrote the value it already had.
            inverseAction:
                previousValue === undefined || previousValue === action.payload.value
                    ? null
                    : {
                          type: 'setYeastProcessorParam',
                          payload: {
                              processorId: action.payload.processorId,
                              paramId: action.payload.paramId,
                              value: previousValue,
                              expectedValue: action.payload.value,
                          },
                      },
            // Redo runs against the post-undo state, whose value is exactly the
            // pre-execution value read here.
            redoAction:
                previousValue === undefined
                    ? undefined
                    : {
                          type: 'setYeastProcessorParam',
                          payload: {
                              processorId: action.payload.processorId,
                              paramId: action.payload.paramId,
                              value: action.payload.value,
                              expectedValue: previousValue,
                          },
                      },
        };
    },
    undoable: true,
});
