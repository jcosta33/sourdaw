import { type ActionHandler, type AppAction, type HandlerDescribeResult } from '#/modules/Command/useCases/commandQueries';

/**
 * Build an `ActionHandler` for one `AppAction` discriminant. Use **only** in `handlers/`.
 * Typical shape: `execute: (action) => myUseCase(…unpack action.payload…)`, plus `describe` / `undoable`.
 * Do **not** call from `get<Module>Handlers` — that file only merges maps.
 */
export function createHandler<K extends AppAction['type']>(config: {
    undoable: boolean;
    execute: (action: Extract<AppAction, { type: K }>) => void | Promise<void>;
    describe: (action: Extract<AppAction, { type: K }>) => HandlerDescribeResult;
}): ActionHandler<Extract<AppAction, { type: K }>> {
    return {
        undoable: config.undoable,
        execute: config.execute as ActionHandler<Extract<AppAction, { type: K }>>['execute'],
        describe: config.describe as ActionHandler<Extract<AppAction, { type: K }>>['describe'],
    };
}
