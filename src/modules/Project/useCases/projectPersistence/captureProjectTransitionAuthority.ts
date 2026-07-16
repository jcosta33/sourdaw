import { projectLoadEpoch } from './helpers/runProjectLoadTransaction';

type ProjectTransitionAuthority = {
    isCurrent: () => boolean;
};

export function captureProjectTransitionAuthority(): ProjectTransitionAuthority {
    const epoch = projectLoadEpoch.current;
    return {
        isCurrent: () => projectLoadEpoch.isCurrent(epoch),
    };
}
