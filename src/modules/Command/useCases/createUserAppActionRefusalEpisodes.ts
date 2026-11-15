import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { describeAppActionRefusal } from './describeAppActionRefusal';
import { executeAppAction, type ExecuteAppActionOptions } from './executeAppAction';
import { isAppActionAdmissionRefusal } from './isAppActionAdmissionRefusal';
import { isAppActionAdmitted } from './isAppActionAdmitted';
import { subscribeAppActionAdmissionChanges } from './subscribeAppActionAdmissionChanges';

/** `committed` reached the project, `refused` was stopped by the admission gate, `skipped` resolved without committing. */
export type UserAppActionOutcome = 'committed' | 'refused' | 'skipped';

export type UserAppActionRefusalEpisodes = {
    execute: (key: string, action: AppAction, options?: ExecuteAppActionOptions) => Promise<UserAppActionOutcome>;
    end: (key: string) => void;
    endAll: () => void;
};

type UserAppActionRefusalEpisodeOptions = {
    /** The key's last refused action would now be admitted; the episode is already closed. */
    onAdmitted?: (key: string) => void;
};

type OpenEpisode = { action: AppAction; projectIdentity: string };

/**
 * Dispatch for edits that are already applied to a session store and committed
 * to the project by a store subscription, so one refused project would
 * otherwise refuse every step of a knob sweep.
 *
 * A refusal opens an episode for its key and notifies once. The episode ends at
 * the key's next committed dispatch, when the caller ends it (the key left the
 * session store), or when the gate would admit the key's last refused action:
 * `onAdmitted` then lets the caller write the session state that was refused.
 * A dispatch that resolves without committing neither ends nor opens anything
 * by itself; it only gives an episode whose action is now admitted its
 * `onAdmitted`. A key the gate still refuses stays open and silent. An episode
 * belongs to the project it was refused in: once the project is replaced it is
 * dropped without `onAdmitted`, because the session state it would write
 * belongs to the outgoing project. The admission subscription is held only
 * while an episode is open. Only the dispatch gate's admission refusal counts:
 * every other failure, a handler or storage conflict included, still rejects
 * unchanged.
 */
export function createUserAppActionRefusalEpisodes(
    options: UserAppActionRefusalEpisodeOptions = {}
): UserAppActionRefusalEpisodes {
    const open = new Map<string, OpenEpisode>();
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
        const projectIdentity = captureProjectIdentity();
        const admitted: string[] = [];
        for (const [key, episode] of open) {
            if (episode.projectIdentity !== projectIdentity) {
                open.delete(key);
            } else if (isAppActionAdmitted(episode.action)) {
                open.delete(key);
                admitted.push(key);
            }
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

    const settleUncommitted = (key: string): void => {
        const episode = open.get(key);
        if (!episode || !isAppActionAdmitted(episode.action)) {
            return;
        }
        close(key);
        options.onAdmitted?.(key);
    };

    return {
        async execute(key, action, executeOptions) {
            let committed = false;
            try {
                await executeAppAction(action, {
                    ...executeOptions,
                    onCommitted: () => {
                        committed = true;
                        executeOptions?.onCommitted?.();
                    },
                });
            } catch (error) {
                if (!isAppActionAdmissionRefusal(error)) {
                    throw error;
                }
                const projectIdentity = captureProjectIdentity();
                const alreadyOpen = open.get(key)?.projectIdentity === projectIdentity;
                open.set(key, { action, projectIdentity });
                syncSubscription();
                if (!alreadyOpen) {
                    notifyUser(
                        `${describeAppActionRefusal(action.type)} Further edits to this device are not saved until the project can be changed.`,
                        'warning'
                    );
                }
                return 'refused';
            }
            if (committed) {
                close(key);
                return 'committed';
            }
            settleUncommitted(key);
            return 'skipped';
        },
        end: close,
        endAll: () => {
            open.clear();
            syncSubscription();
        },
    };
}
