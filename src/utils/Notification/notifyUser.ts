import { eventBus } from '#/app/registerDependencies';

export function notifyUser(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    eventBus.emit('ui.notify', { message, level });
}
