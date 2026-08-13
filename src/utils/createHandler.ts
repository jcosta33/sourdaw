import {
    type ActionHandler,
    type AppAction,
    type HandlerDescribeResult,
    type HandlerExecutionResult,
} from './handlerContract';

/**
 * Build an `ActionHandler` for one `AppAction` discriminant. Use **only** in `handlers/`.
 * Typical shape: `execute: (action) => myUseCase(…unpack action.payload…)`, plus `describe` / `undoable`.
 * Do **not** call from `get<Module>Handlers` — that file only merges maps.
 */
export function createHandler<ActionType extends AppAction['type']>(config: {
    undoable: boolean;
    execute: (
        action: Extract<AppAction, { type: ActionType }>
    ) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>;
    describe: (action: Extract<AppAction, { type: ActionType }>) => HandlerDescribeResult;
    validate?: (action: Extract<AppAction, { type: ActionType }>) => boolean;
    materializeCommandArguments?: (action: Extract<AppAction, { type: ActionType }>) => void;
    prepareAbort?: (action: Extract<AppAction, { type: ActionType }>) => () => void | Promise<void>;
    isNoop?: (action: Extract<AppAction, { type: ActionType }>) => boolean;
    requiresAbortCompensation?: boolean;
    executionKind?: 'project' | 'runtime';
    batchExecution?: 'singleton';
}): ActionHandler<Extract<AppAction, { type: ActionType }>> {
    return {
        undoable: config.undoable,
        execute: config.execute,
        describe: config.describe,
        validate: config.validate,
        materializeCommandArguments: config.materializeCommandArguments,
        prepareAbort: config.prepareAbort,
        isNoop: config.isNoop,
        requiresAbortCompensation: config.requiresAbortCompensation,
        executionKind: config.executionKind,
        batchExecution: config.batchExecution,
    };
}
