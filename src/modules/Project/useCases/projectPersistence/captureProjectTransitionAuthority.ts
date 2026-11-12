import { projectTransitionEpoch } from '../../stores/projectTransitionEpoch';

type ProjectTransitionAuthority = {
    isCurrent: () => boolean;
};

export function captureProjectTransitionAuthority(): ProjectTransitionAuthority {
    const epoch = projectTransitionEpoch.current;
    return {
        isCurrent: () => projectTransitionEpoch.isCurrent(epoch),
    };
}
