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

/** Where an open episode stands now: replaced project, admitted again, or still refused. */
function readVerdict(episode: OpenEpisode): 'stale' | 'admitted' | 'refused' {
    if (episode.projectIdentity !== captureProjectIdentity()) {
        return 'stale';
    }
    return isAppActionAdmitted(episode.action) ? 'admitted' : 'refused';
}

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
 *
 * Admitted keys are delivered a microtask after the signal: a merge that unlocks the project also
 * rewrites device state, and the device reconcile that loads a peer's state into the session stores
 * is queued by the change notification ahead of the projection that fires the signal. Writing at
 * once would put the stale session state over the peer's edit.
 */
export function createUserAppActionRefusalEpisodes(
    options: UserAppActionRefusalEpisodeOptions = {}
): UserAppActionRefusalEpisodes {
    const open = new Map<string, OpenEpisode>();
    let unsubscribe: (() => void) | null = null;

    function syncSubscription(): void {
        if (open.size === 0) {
            unsubscribe?.();
            unsubscribe = null;
            return;
        }
        unsubscribe ??= subscribeAppActionAdmissionChanges(closeAdmittedEpisodes);
    }

    function deliverAdmitted(admitted: [string, OpenEpisode][]): void {
        queueMicrotask(() => {
            for (const [key, episode] of admitted) {
                if (readVerdict(episode) === 'admitted') {
                    options.onAdmitted?.(key);
                }
            }
        });
    }

    function closeAdmittedEpisodes(): void {
        const admitted: [string, OpenEpisode][] = [];
        for (const [key, episode] of open) {
            const verdict = readVerdict(episode);
            if (verdict === 'refused') {
                continue;
            }
            open.delete(key);
            if (verdict === 'admitted') {
                admitted.push([key, episode]);
            }
        }
        syncSubscription();
        if (admitted.length > 0) {
            deliverAdmitted(admitted);
        }
    }

    function close(key: string): void {
        open.delete(key);
        syncSubscription();
    }

    function settleUncommitted(key: string): void {
        const episode = open.get(key);
        if (!episode) {
            return;
        }
        const verdict = readVerdict(episode);
        if (verdict === 'refused') {
            return;
        }
        close(key);
        if (verdict === 'admitted') {
            options.onAdmitted?.(key);
        }
    }

    return {
        async execute(key, action, executeOptions) {
            const dispatch = { committed: false };
            try {
                await executeAppAction(action, {
                    ...executeOptions,
                    onCommitted: () => {
                        dispatch.committed = true;
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
            if (dispatch.committed) {
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
