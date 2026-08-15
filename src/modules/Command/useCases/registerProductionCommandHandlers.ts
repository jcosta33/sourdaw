import { registerHandlerMap } from '../stores/handlerRegistry';
import { hydrateUndoStoreFromSession } from '../stores/undoStore';

import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';

type HandlerMap = Parameters<typeof registerHandlerMap>[0];

export function registerProductionCommandHandlers(handlerMaps: readonly HandlerMap[]): void {
    for (const handlerMap of handlerMaps) {
        registerHandlerMap(handlerMap);
    }
    const registrations = getExecutableCommandRegistrations();
    for (const registration of registrations) {
        void registration.handler;
    }
    hydrateUndoStoreFromSession(
        registrations.map((registration) => [registration.actionType, registration.operationVersion] as const)
    );
}
