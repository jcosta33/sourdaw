import { clearActionHistory } from '#/modules/Command/useCases';

type CompleteProjectIdentityTransition = () => void;

export function beginProjectIdentityTransition(): CompleteProjectIdentityTransition {
    clearActionHistory();

    let completed = false;
    return () => {
        if (completed) {
            return;
        }
        completed = true;
        clearActionHistory();
    };
}
