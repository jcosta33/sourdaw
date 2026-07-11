import { clearActionHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';

type CompleteProjectIdentityTransition = () => void;

export function beginProjectIdentityTransition(): CompleteProjectIdentityTransition {
    resetActionReplayAuthority();

    let completed = false;
    return () => {
        if (completed) {
            return;
        }
        completed = true;
        clearActionHistory();
    };
}
