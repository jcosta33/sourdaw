import { logger } from '#/infra/logger/appLogger';

import { type ActionHandler } from '../useCases/commandQueries';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerMap = Record<string, ActionHandler<any>>;

const registry: HandlerMap = {};

export function registerHandlerMap(map: HandlerMap): void {
    for (const key of Object.keys(map)) {
        if (key in registry) {
            const message = `[handlerRegistry] Duplicate handler for action type: ${key}`;
            if (import.meta.env.DEV) {
                throw new Error(message);
            }
            logger.warn(message);
        }
        registry[key] = map[key]!;
    }
}

export function getHandlerMap(): HandlerMap {
    return registry;
}

export function clearHandlerRegistry(): void {
    for (const key of Object.keys(registry)) {
        delete registry[key];
    }
}
