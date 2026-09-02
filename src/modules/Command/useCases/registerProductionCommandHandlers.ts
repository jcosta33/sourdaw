import { registerHandlerMap } from '../stores/handlerRegistry';
import { hydrateUndoStoreFromSession } from '../stores/undoStore';

import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';
import { getInternalUndoSessionReplayContracts } from './getInternalUndoSessionReplayContracts';

type HandlerMap = Parameters<typeof registerHandlerMap>[0];

export function registerProductionCommandHandlers(handlerMaps: readonly HandlerMap[]): void {
    for (const handlerMap of handlerMaps) {
        registerHandlerMap(handlerMap);
    }
    const registrations = getExecutableCommandRegistrations();
    for (const registration of registrations) {
        void registration.handler;
    }
    hydrateUndoStoreFromSession([
        ...registrations.map((registration) => ({
            actionType: registration.actionType,
            operationVersion: registration.operationVersion,
            validateArguments: registration.runtimeSchema.validate,
            validateEntry: registration.sessionEntryValidator,
        })),
        ...getInternalUndoSessionReplayContracts(),
    ]);
}
