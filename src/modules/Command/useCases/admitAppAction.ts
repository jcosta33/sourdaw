import { type AppAction } from '#/utils/handlerContract';

import { getProjectMutationAdmissionFailure } from './getProjectMutationAdmissionFailure';
import { productionBriefAdmissionPort } from './productionBriefAdmissionPort';

/**
 * The dispatch gate's preflight, defined once: the project is not awaiting
 * repair and the production brief does not lock what the action touches. The
 * repair check runs first, so a repair-required project never captures a brief
 * footprint. `briefAllowsCurrent` re-asks the one footprint captured here, which
 * the kernel does again at commit.
 */
export function admitAppAction(action: AppAction): { admitted: boolean; briefAllowsCurrent: () => boolean } {
    if (getProjectMutationAdmissionFailure(action) !== null) {
        return { admitted: false, briefAllowsCurrent: () => false };
    }
    const brief = productionBriefAdmissionPort.capture([action]);
    return { admitted: brief.allowsCurrent(), briefAllowsCurrent: () => brief.allowsCurrent() };
}
