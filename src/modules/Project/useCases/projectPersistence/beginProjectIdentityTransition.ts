import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { projectIdentityTransitionDependencies } from './projectIdentityTransitionDependencies';

type ProjectIdentityTransition = {
    isCurrent: () => boolean;
    prepare: () => Promise<boolean>;
    complete: () => boolean;
};

let latest_project_identity_transition_epoch = 0;

export function beginProjectIdentityTransition(): ProjectIdentityTransition {
    latest_project_identity_transition_epoch += 1;
    const epoch = latest_project_identity_transition_epoch;
    resetActionReplayAuthority();

    let completed = false;
    let prepared = false;
    let preparation: Promise<boolean> | null = null;
    const is_current = () => epoch === latest_project_identity_transition_epoch;

    return {
        isCurrent: is_current,
        prepare: () => {
            preparation ??= (async () => {
                await projectIdentityTransitionDependencies.leaveCollaborationSession();
                if (!is_current()) {
                    return false;
                }
                prepared = true;
                return true;
            })();
            return preparation;
        },
        complete: () => {
            if (completed || !prepared || !is_current()) {
                return false;
            }
            completed = true;
            return true;
        },
    };
}
