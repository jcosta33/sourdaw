import { APP_EVENTS } from '#/helpers/Event/appEvents';

export function notifyUser(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    document.dispatchEvent(
        new CustomEvent(APP_EVENTS.NOTIFY, {
            detail: { message, level },
        })
    );
}
