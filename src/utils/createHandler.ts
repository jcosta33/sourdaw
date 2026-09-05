import {
    type ActionHandler,
    type AppAction,
    type HandlerDescribeResult,
    type HandlerExecutionResult,
    type HandlerSessionActionEntry,
    type HandlerValidationContext,
} from './handlerContract';

/**
 * Build an `ActionHandler` for one `AppAction` discriminant. Use **only** in `handlers/`.
 * Typical shape: `execute: (action) => myUseCase(…unpack action.payload…)`, plus `describe` / `undoable`.
 * Do **not** call from `get<Module>Handlers` — that file only merges maps.
 */
type HandlerConfig<ActionType extends AppAction['type']> = {
    undoable: boolean;
    describe: (
        action: Extract<AppAction, { type: ActionType }>,
        context?: HandlerValidationContext
    ) => HandlerDescribeResult;
    validate?: (action: Extract<AppAction, { type: ActionType }>, context: HandlerValidationContext) => boolean;
    canReapplyAfterDivergence?: (
        action: Extract<AppAction, { type: ActionType }>,
        context?: HandlerValidationContext
    ) => boolean;
    /** See `ActionHandlerCommon.canReportConflict`; only set it once `execute` has a genuine conflict path. */
    canReportConflict?: boolean;
    materializeCommandArguments?: (action: Extract<AppAction, { type: ActionType }>) => void;
    validateMaterializedCommandArguments?: (payload: unknown) => boolean;
    validateSessionActionArguments?: (payload: unknown) => boolean;
    prepareAbort?: (action: Extract<AppAction, { type: ActionType }>) => () => void | Promise<void>;
    isNoop?: (action: Extract<AppAction, { type: ActionType }>) => boolean;
    validateSessionEntry?: (entry: HandlerSessionActionEntry) => boolean;
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
          previewExecution: 'unsupported-external';
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
        canReapplyAfterDivergence: config.canReapplyAfterDivergence,
        canReportConflict: config.canReportConflict ?? false,
        materializeCommandArguments: config.materializeCommandArguments,
        validateMaterializedCommandArguments: config.validateMaterializedCommandArguments,
        validateSessionActionArguments: config.validateSessionActionArguments,
        prepareAbort: config.prepareAbort,
        isNoop: config.isNoop,
        validateSessionEntry: config.validateSessionEntry,
        requiresAbortCompensation: config.requiresAbortCompensation,
        executionKind: config.executionKind,
        batchExecution,
        batchRestriction,
    };
    if (config.previewExecution === 'isolated-project') {
        return { ...common, execute: config.execute, previewExecution: 'isolated-project' };
    }
    if (config.previewExecution === 'unsupported-external') {
        return { ...common, execute: config.execute, previewExecution: 'unsupported-external' };
    }
    return { ...common, execute: config.execute, previewExecution: undefined };
}
