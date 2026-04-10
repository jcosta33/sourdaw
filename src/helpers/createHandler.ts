import { type ActionHandler, type AppAction, type HandlerDescribeResult } from '#/modules/Command';

/**
 * Build a single `ActionHandler` with a typed `execute` / `describe` pair.
 * Call **only** from handler modules — e.g. `export const handleMuteTrack = createHandler<'muteTrack'>({ … })`
 * or `export const handleMuteTrack = () => createHandler<'muteTrack'>({ … })` when a factory is required.
 * Do **not** call `createHandler` from `get<Module>Handlers` or other use cases.
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

/**
 * Assemble one handler-module map from **already-built** `ActionHandler` values (`handleX` from `createHandler`).
 * Use **inside** each `*Handlers.ts` (or `handlers/*.ts`) file — not in `get<Module>Handlers`.
 */
export function createHandlers<const T extends Record<string, ActionHandler<any>>>(handlers: T): T {
    return handlers;
}
