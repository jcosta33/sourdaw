import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

/**
 * Action-handler registry shared across the app.
 *
 * Lives in `stores/` because it is shared mutable state — not a business
 * operation. Modules register their handler maps via `registerHandlerMap` at
 * app bootstrap. `executeAppAction` reads the merged map via `getHandlerMap`.
 *
 * Moving this off `executeAppAction.ts` cuts the static imports that used to
 * fan out from Command to every handler-owning module, which was producing
 * hundreds of dep-cruiser warnings (Command → X/useCases → … → Command).
 * Bootstrap wires each `get<Module>Handlers` in one place; no module
 * statically imports another module's handler factory.
 */

type HandlerMap = {
    [ActionType in AppAction['type']]?: ActionHandler<Extract<AppAction, { type: ActionType }>>;
};

const registry: HandlerMap = {};

export function registerHandlerMap(map: HandlerMap): void {
    for (const key of Object.keys(map)) {
        if (key in registry) {
            // A duplicate registration is a bootstrap programming error: two
            // handler maps claim the same action type, so which one wins is
            // non-deterministic (it depends on bootstrap ordering). Previously
            // PROD only logged a warning and let the second registration
            // silently overwrite the first; that masked the conflict and could
            // route an action to the wrong handler. Fail loudly in every
            // environment so the conflict is caught at wire-up time.
            throw new Error(`[handlerRegistry] Duplicate handler for action type: ${key}`);
        }
    }
    Object.assign(registry, map);
}

export function getHandlerMap(): HandlerMap {
    return registry;
}

export function getHandlerByType<ActionType extends AppAction['type']>(
    actionType: ActionType
): ActionHandler<Extract<AppAction, { type: ActionType }>> | undefined {
    return registry[actionType];
}

export function getHandler<ActionType extends AppAction['type']>(
    action: Extract<AppAction, { type: ActionType }>
): ActionHandler<Extract<AppAction, { type: ActionType }>> | undefined {
    return getHandlerByType(action.type);
}

export function clearHandlerRegistry(): void {
    for (const key of Object.keys(registry)) {
        Reflect.deleteProperty(registry, key);
    }
}
