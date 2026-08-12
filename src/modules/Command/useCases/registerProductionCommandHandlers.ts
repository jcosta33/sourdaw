import { registerHandlerMap } from '../stores/handlerRegistry';

import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';

type HandlerMap = Parameters<typeof registerHandlerMap>[0];

export function registerProductionCommandHandlers(handlerMaps: readonly HandlerMap[]): void {
    for (const handlerMap of handlerMaps) {
        registerHandlerMap(handlerMap);
    }
    for (const registration of getExecutableCommandRegistrations()) {
        void registration.handler;
    }
}
