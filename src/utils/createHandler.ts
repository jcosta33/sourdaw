import { type ActionHandler, type AppAction, type HandlerDescribeResult } from '#/modules/Command/useCases';

/**
 * Build an `ActionHandler` for one `AppAction` discriminant. Use **only** in `handlers/`.
 * Typical shape: `execute: (action) => myUseCase(…unpack action.payload…)`, plus `describe` / `undoable`.
 * Do **not** call from `get<Module>Handlers` — that file only merges maps.
 */
export function createHandler<ActionType extends AppAction['type']>(config: {
    undoable: boolean;
    execute: (action: Extract<AppAction, { type: ActionType }>) => void | Promise<void>;
    describe: (action: Extract<AppAction, { type: ActionType }>) => HandlerDescribeResult;
}): ActionHandler<Extract<AppAction, { type: ActionType }>> {
    return {
        undoable: config.undoable,
        execute: config.execute as ActionHandler<Extract<AppAction, { type: ActionType }>>['execute'],
        describe: config.describe as ActionHandler<Extract<AppAction, { type: ActionType }>>['describe'],
    };
}
