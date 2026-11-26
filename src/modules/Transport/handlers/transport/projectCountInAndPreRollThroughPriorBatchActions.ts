import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

type Setting = 'countIn' | 'preRoll';

function priorActions(context: HandlerValidationContext | undefined): readonly AppAction[] {
    return context === undefined ? [] : context.actions.slice(0, context.actionIndex);
}

/**
 * `executeAppActionBatch` describes and validates every action before any executes, so a second
 * count-in or pre-roll action of one batch must start from what the earlier ones leave, not the
 * live state, or its inverse would carry a guard the batch itself can never satisfy. A write the
 * execution refuses as a conflict is not modelled: the batch then fails as a whole.
 */
export function projectEnabledThroughPriorBatchActions(
    setting: Setting,
    live: boolean,
    context: HandlerValidationContext | undefined
): boolean {
    const toggleType = setting === 'countIn' ? 'toggleCountIn' : 'togglePreRoll';
    let projected = live;
    for (const action of priorActions(context)) {
        if (action.type === toggleType) {
            projected = action.payload.enabled;
        }
    }
    return projected;
}

export function projectBarsThroughPriorBatchActions(
    setting: Setting,
    live: number,
    context: HandlerValidationContext | undefined
): number {
    const barsType = setting === 'countIn' ? 'setCountInBars' : 'setPreRollBars';
    let projected = live;
    for (const action of priorActions(context)) {
        if (action.type === barsType) {
            projected = action.payload.bars;
        }
    }
    return projected;
}
