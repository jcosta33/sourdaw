import { inject } from '#/infra/di/inject';

import { NotificationEventBus } from './notificationEventBus';

/**
 * Async confirmation dialog. Replaces \`window.confirm\` (§183.1, §196.1)
 * which synchronously blocks the JS event loop and causes audible
 * dropouts in the audio scheduler while the dialog is open.
 *
 * Usage:
 *
 *     if (await confirmUser({ message: 'Delete this track?', variant: 'danger' })) {
 *         removeTrack(id);
 *     }
 *
 * The promise resolves with \`true\` when the user clicks the confirm
 * button, \`false\` otherwise (cancel, dismiss, or close). It does not
 * reject — callers don't need a try/catch.
 */
export type ConfirmUserOptions = {
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
};

export const confirmUser = inject({ eventBus: NotificationEventBus })(
    ({ eventBus }) =>
        function confirmUser(options: ConfirmUserOptions): Promise<boolean> {
            return new Promise<boolean>((resolve) => {
                void eventBus.emit('ui.confirm', {
                    id: crypto.randomUUID(),
                    message: options.message,
                    title: options.title,
                    confirmLabel: options.confirmLabel,
                    cancelLabel: options.cancelLabel,
                    variant: options.variant,
                    resolve,
                });
            });
        }
);
