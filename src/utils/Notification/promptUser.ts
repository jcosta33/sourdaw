import { inject } from '#/infra/di/inject';

import { NotificationEventBus } from './notificationEventBus';

/**
 * Async single-field text prompt. Sibling of `confirmUser` — replaces
 * `window.prompt`, which synchronously blocks the JS event loop (audible
 * scheduler dropouts).
 *
 * Usage:
 *
 *     const name = await promptUser({ title: 'Rename Track', message: 'New name', initialValue: track.name });
 *     if (name) {
 *         renameTrack(id, name);
 *     }
 *
 * The promise resolves with the trimmed input on submit, or `null` on cancel /
 * dismiss / empty input. It does not reject — callers don't need a try/catch.
 */
export type PromptUserOptions = {
    message: string;
    title?: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
};

export const promptUser = inject({ eventBus: NotificationEventBus })(
    ({ eventBus }) =>
        function promptUser(options: PromptUserOptions): Promise<string | null> {
            return new Promise<string | null>((resolve) => {
                void eventBus.emit('ui.prompt', {
                    id: crypto.randomUUID(),
                    message: options.message,
                    title: options.title,
                    initialValue: options.initialValue,
                    placeholder: options.placeholder,
                    confirmLabel: options.confirmLabel,
                    cancelLabel: options.cancelLabel,
                    resolve,
                });
            });
        }
);
