import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { describeAppActionRefusal } from './describeAppActionRefusal';
import { executeAppAction, type ExecuteAppActionOptions } from './executeAppAction';
import { isAppActionAdmissionRefusal } from './isAppActionAdmissionRefusal';
import { isAppActionAdmitted } from './isAppActionAdmitted';
import { subscribeAppActionAdmissionChanges } from './subscribeAppActionAdmissionChanges';

export type UserAppActionRefusalEpisodes = {
    execute: (key: string, action: AppAction, options?: ExecuteAppActionOptions) => Promise<void>;
    end: (key: string) => void;
    endAll: () => void;
};

type UserAppActionRefusalEpisodeOptions = {
    /** The key's last refused action would now be admitted; the episode is already closed. */
    onAdmitted?: (key: string) => void;
};

/**
 * Dispatch for edits that are already applied to a session store and committed
 * to the project by a store subscription, so one refused project would
 * otherwise refuse every step of a knob sweep.
 *
 * A refusal opens an episode for its key and notifies once. The episode ends at
 * the key's next successful dispatch, when the caller ends it (the key left the
 * session store), or when the gate would admit the key's last refused action:
 * `onAdmitted` then lets the caller write the session state that was refused.
 * A key the gate still refuses stays open and silent. The admission
 * subscription is held only while an episode is open. Only the dispatch gate's
 * admission refusal counts: every other failure, a handler or storage conflict
 * included, still rejects unchanged.
 */
export function createUserAppActionRefusalEpisodes(
    options: UserAppActionRefusalEpisodeOptions = {}
): UserAppActionRefusalEpisodes {
    const open = new Map<string, AppAction>();
    let unsubscribe: (() => void) | null = null;

    const syncSubscription = (): void => {
        if (open.size === 0) {
            unsubscribe?.();
            unsubscribe = null;
            return;
        }
        unsubscribe ??= subscribeAppActionAdmissionChanges(closeAdmittedEpisodes);
    };

    function closeAdmittedEpisodes(): void {
        const admitted = [...open].filter(([, action]) => isAppActionAdmitted(action)).map(([key]) => key);
        for (const key of admitted) {
            open.delete(key);
        }
        syncSubscription();
        for (const key of admitted) {
            options.onAdmitted?.(key);
        }
    }

    const close = (key: string): void => {
        open.delete(key);
        syncSubscription();
    };

    return {
        async execute(key, action, executeOptions) {
            try {
                await executeAppAction(action, executeOptions);
            } catch (error) {
                if (!isAppActionAdmissionRefusal(error)) {
                    throw error;
                }
                const alreadyOpen = open.has(key);
                open.set(key, action);
                syncSubscription();
                if (alreadyOpen) {
                    return;
                }
                notifyUser(
                    `${describeAppActionRefusal(action.type)} Further edits to this device are not saved until the project can be changed.`,
                    'warning'
                );
                return;
            }
            close(key);
        },
        end: close,
        endAll: () => {
            open.clear();
            syncSubscription();
        },
    };
}
