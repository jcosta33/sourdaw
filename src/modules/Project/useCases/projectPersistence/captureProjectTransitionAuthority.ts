import { projectTransitionEpoch } from '../../stores/projectTransitionEpoch';

/** Fresh operations capture the retained active project, not a retired load ticket. */
export function captureProjectTransitionAuthority() {
    return projectTransitionEpoch.captureEditAuthority();
}
