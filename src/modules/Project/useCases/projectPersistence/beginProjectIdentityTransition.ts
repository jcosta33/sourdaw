import { clearActionHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';

type ProjectIdentityTransition = {
    isCurrent: () => boolean;
    complete: () => boolean;
};

let latest_project_identity_transition_epoch = 0;

export function beginProjectIdentityTransition(): ProjectIdentityTransition {
    latest_project_identity_transition_epoch += 1;
    const epoch = latest_project_identity_transition_epoch;
    resetActionReplayAuthority();

    let completed = false;
    const is_current = () => epoch === latest_project_identity_transition_epoch;

    return {
        isCurrent: is_current,
        complete: () => {
            if (completed || !is_current()) {
                return false;
            }
            clearActionHistory();
            completed = true;
            return true;
        },
    };
}
