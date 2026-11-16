import { captureProjectIdentity } from '#/modules/CrdtDocument/stores';
import { type AppAction } from '#/utils/handlerContract';

import { executeAppAction, type ExecuteAppActionOptions } from './executeAppAction';
import { isAppActionAdmissionRefusal } from './isAppActionAdmissionRefusal';
import { createRefusalEpisodeBook } from './refusalEpisodeBook';

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

/**
 * Dispatch for edits that are already applied to a session store and committed
 * to the project by a store subscription, so one refused project would
 * otherwise refuse every step of a knob sweep.
 *
 * A refusal opens an episode for its key and notifies once. The episode ends at
 * the key's next committed dispatch, when the caller ends it (the key left the
 * session store), or when the gate would admit the key's last refused action:
 * `onAdmitted` then lets the caller write the session state that was refused.
 * A gate that already admits the action by the time its refusal is handled
 * delivers it the same way, without a warning. A dispatch that resolves without
 * committing neither ends nor opens anything by itself; it only gives an
 * episode whose action is now admitted its `onAdmitted`. A key the gate still
 * refuses stays open and silent, including one the gate refuses again before
 * its delivery runs. An episode belongs to the project its dispatch started
 * in: once the project is replaced it is dropped without `onAdmitted` or a
 * warning, because the session state it would write belongs to the outgoing
 * project. A refusal whose key the caller ended while its dispatch was in
 * flight opens nothing, because the key left the session store before the
 * refusal landed. The admission subscription is held only while an episode is open.
 * Only the dispatch gate's admission refusal counts: every other failure, a
 * handler or storage conflict included, still rejects unchanged.
 *
 * Admitted keys are delivered a microtask after the signal: a merge that unlocks the project also
 * rewrites device state, and the device reconcile that loads a peer's state into the session stores
 * is queued by the change notification ahead of the projection that fires the signal. Writing at
 * once would put the stale session state over the peer's edit.
 */
export function createUserAppActionRefusalEpisodes(
    options: UserAppActionRefusalEpisodeOptions = {}
): UserAppActionRefusalEpisodes {
    const episodes = createRefusalEpisodeBook(options.onAdmitted);
    return {
        async execute(key, action, executeOptions) {
            const dispatch = { committed: false };
            const projectIdentity = captureProjectIdentity();
            const endMark = episodes.endMarkOf(key);
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
                episodes.openRefused(key, { action, projectIdentity, endMark });
                return 'refused';
            }
            if (dispatch.committed) {
                episodes.close(key);
                return 'committed';
            }
            episodes.settleUncommitted(key);
            return 'skipped';
        },
        end: episodes.end,
        endAll: episodes.endAll,
    };
}
