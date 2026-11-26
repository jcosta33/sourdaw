import { createHandler } from './createHandler';
import {
    type ActionHandler,
    type AppAction,
    type HandlerExecutionResult,
    type HandlerValidationContext,
} from './handlerContract';

type ActionOf<ActionType extends AppAction['type']> = Extract<AppAction, { type: ActionType }>;

/**
 * Describes a setter action that writes one value and guards its own undo and redo with an optional
 * expected-state payload field. `Value` is the state the action writes; `Expected` is what the guard
 * field carries (the same shape unless a guard may name only part of the value).
 */
type ExpectedValueHandlerConfig<ActionType extends AppAction['type'], Value, Expected = Value> = {
    label: (action: ActionOf<ActionType>) => string;
    /** The value this action writes. */
    requested: (action: ActionOf<ActionType>) => Value;
    /** The guard the payload carries, or undefined when the action is not guarded. */
    expected: (action: ActionOf<ActionType>) => Expected | undefined;
    /**
     * The value the target holds: as the batch's earlier actions leave it when a context is given,
     * otherwise as the store holds it now. Undefined when the target is absent.
     */
    read: (action: ActionOf<ActionType>, context?: HandlerValidationContext) => Value | undefined;
    /** The same action asking for `value`, guarded by `expected`. */
    withExpected: (action: ActionOf<ActionType>, value: Value, expected: Value) => ActionOf<ActionType>;
    write: (action: ActionOf<ActionType>) => HandlerExecutionResult;
    /** Whether `current` satisfies `expected`. Defaults to strict equality. */
    matches?: (current: Value, expected: Expected) => boolean;
    /** Whether two values are the same state. Defaults to strict equality. */
    sameValue?: (a: Value, b: Value) => boolean;
    /** See `ActionHandlerCommon.canReportConflict`; only a handler with a proven conflict fixture sets it. */
    canReportConflict?: boolean;
    /** A result that ends the action before any guard or write. */
    refuse?: (action: ActionOf<ActionType>) => HandlerExecutionResult | null;
};

/**
 * Builds the handler of a single-value setter. The expected field is optional, so a user-issued action
 * is unguarded. The recorded inverse expects the value the action writes, and the recorded redo expects
 * the value it replaced; both answer `canReapplyAfterDivergence`, so an atomic batch can compensate them
 * and a divergent edit becomes a conflict instead of an overwrite.
 */
export function createExpectedValueHandler<ActionType extends AppAction['type'], Value, Expected = Value>(
    config: ExpectedValueHandlerConfig<ActionType, Value, Expected>
): ActionHandler<ActionOf<ActionType>> {
    const matches = config.matches ?? ((current: Value, expected: Expected) => Object.is(current, expected));
    const sameValue = config.sameValue ?? ((a: Value, b: Value) => Object.is(a, b));

    function satisfiesGuard(action: ActionOf<ActionType>, context?: HandlerValidationContext): boolean {
        const expected = config.expected(action);
        if (expected === undefined) {
            return true;
        }
        const current = config.read(action, context);
        return current !== undefined && matches(current, expected);
    }

    return createHandler<ActionType>({
        canReportConflict: config.canReportConflict,
        canReapplyAfterDivergence: (action) => config.expected(action) !== undefined,
        validate: (action, context) => satisfiesGuard(action, context),
        execute: (action) => {
            const refusal = config.refuse?.(action);
            if (refusal) {
                return refusal;
            }
            if (!satisfiesGuard(action)) {
                return { status: 'conflict' };
            }
            return config.write(action);
        },
        describe: (action, context) => {
            const previous = config.read(action, context);
            if (previous === undefined) {
                return { label: config.label(action), inverseAction: null, redoAction: action };
            }
            const written = config.requested(action);
            return {
                label: config.label(action),
                inverseAction: config.withExpected(action, previous, written),
                redoAction: config.withExpected(action, written, previous),
            };
        },
        isNoop: (action) => {
            const current = config.read(action);
            // A target already holding the value is a no-op whatever the guard says: a peer that wrote the value first leaves nothing to undo.
            return current !== undefined && sameValue(current, config.requested(action));
        },
        undoable: true,
    });
}
