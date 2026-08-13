import {
    type ActionHandler,
    type AppAction,
    type HandlerDescribeResult,
    type HandlerExecutionResult,
    type HandlerValidationContext,
} from './handlerContract';

/**
 * Build an `ActionHandler` for one `AppAction` discriminant. Use **only** in `handlers/`.
 * Typical shape: `execute: (action) => myUseCase(…unpack action.payload…)`, plus `describe` / `undoable`.
 * Do **not** call from `get<Module>Handlers` — that file only merges maps.
 */
type HandlerConfig<ActionType extends AppAction['type']> = {
    undoable: boolean;
    describe: (action: Extract<AppAction, { type: ActionType }>) => HandlerDescribeResult;
    validate?: (action: Extract<AppAction, { type: ActionType }>, context: HandlerValidationContext) => boolean;
    materializeCommandArguments?: (action: Extract<AppAction, { type: ActionType }>) => void;
    prepareAbort?: (action: Extract<AppAction, { type: ActionType }>) => () => void | Promise<void>;
    isNoop?: (action: Extract<AppAction, { type: ActionType }>) => boolean;
    requiresAbortCompensation?: boolean;
    executionKind?: 'project' | 'runtime';
    batchExecution?: 'singleton';
} & (
    | {
          previewExecution: 'isolated-project';
          execute: (
              action: Extract<AppAction, { type: ActionType }>,
              context?: HandlerValidationContext
          ) => void | HandlerExecutionResult;
      }
    | {
          previewExecution?: undefined;
          requiresAbortCompensation: false;
          execute: (
              action: Extract<AppAction, { type: ActionType }>,
              context?: HandlerValidationContext
          ) => void | HandlerExecutionResult;
      }
    | {
          previewExecution: 'unsupported-async';
          requiresAbortCompensation: false;
          execute: (
              action: Extract<AppAction, { type: ActionType }>,
              context?: HandlerValidationContext
          ) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>;
      }
    | {
          previewExecution?: undefined;
          requiresAbortCompensation?: true | undefined;
          execute: (
              action: Extract<AppAction, { type: ActionType }>,
              context?: HandlerValidationContext
          ) => void | HandlerExecutionResult | Promise<void | HandlerExecutionResult>;
      }
);

export function createHandler<ActionType extends AppAction['type']>(
    config: HandlerConfig<ActionType>
): ActionHandler<Extract<AppAction, { type: ActionType }>> {
    const batchExecution = config.batchExecution ?? (config.validate ? undefined : 'singleton');
    let batchRestriction: ActionHandler['batchRestriction'];
    if (config.batchExecution === 'singleton') {
        batchRestriction = 'domain-singleton';
    } else if (!config.validate) {
        batchRestriction = 'missing-validation';
    }
    const common = {
        undoable: config.undoable,
        describe: config.describe,
        validate: config.validate ?? (() => true),
        materializeCommandArguments: config.materializeCommandArguments,
        prepareAbort: config.prepareAbort,
        isNoop: config.isNoop,
        requiresAbortCompensation: config.requiresAbortCompensation,
        executionKind: config.executionKind,
        batchExecution,
        batchRestriction,
    };
    if (config.previewExecution === 'isolated-project' || config.requiresAbortCompensation === false) {
        if (config.previewExecution === 'unsupported-async') {
            return { ...common, execute: config.execute, previewExecution: config.previewExecution };
        }
        return { ...common, execute: config.execute, previewExecution: 'isolated-project' };
    }
    return { ...common, execute: config.execute, previewExecution: undefined };
}
