import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionConflictError } from '../errors/AppActionExecutionError';

import { describeAppActionRefusal } from './describeAppActionRefusal';
import { executeAppAction, type ExecuteAppActionOptions } from './executeAppAction';

export type UserAppActionRefusalEpisodes = {
    execute: (key: string, action: AppAction, options?: ExecuteAppActionOptions) => Promise<void>;
    end: (key: string) => void;
    endAll: () => void;
};

/**
 * Dispatch for edits that are already applied to a session store and committed
 * to the project by a store subscription, so one refused project would
 * otherwise refuse every step of a knob sweep.
 *
 * A refusal opens an episode for its key and notifies once; the episode ends at
 * the key's next successful dispatch or when the caller ends it (the key left
 * the session store). Failures other than a refusal still reject unchanged.
 */
export function createUserAppActionRefusalEpisodes(): UserAppActionRefusalEpisodes {
    const open = new Set<string>();

    return {
        async execute(key, action, options) {
            try {
                await executeAppAction(action, options);
            } catch (error) {
                if (!(error instanceof AppActionConflictError)) {
                    throw error;
                }
                if (open.has(key)) {
                    return;
                }
                open.add(key);
                notifyUser(
                    `${describeAppActionRefusal(action.type)} Further edits to this device are not saved until the project can be changed.`,
                    'warning'
                );
                return;
            }
            open.delete(key);
        },
        end: (key) => {
            open.delete(key);
        },
        endAll: () => {
            open.clear();
        },
    };
}
