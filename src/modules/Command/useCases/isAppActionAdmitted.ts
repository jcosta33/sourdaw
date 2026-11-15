import { type AppAction } from '#/utils/handlerContract';

import { getProjectMutationAdmissionFailure } from './getProjectMutationAdmissionFailure';
import { productionBriefAdmissionPort } from './productionBriefAdmissionPort';

/**
 * Captures the production brief footprint of `action` once, so the kernel can
 * ask the same footprint again at commit. `admitsNow` is the dispatch gate's
 * whole preflight: the project is not awaiting repair and the brief does not
 * lock what the action touches.
 */
export function captureAppActionAdmission(action: AppAction): {
    admitsNow: () => boolean;
    briefAllowsCurrent: () => boolean;
} {
    const brief = productionBriefAdmissionPort.capture([action]);
    return {
        admitsNow: () => getProjectMutationAdmissionFailure(action) === null && brief.allowsCurrent(),
        briefAllowsCurrent: () => brief.allowsCurrent(),
    };
}

/** Whether the dispatch gate would admit this action right now; the kernel preflight and the refusal episodes share it. */
export function isAppActionAdmitted(action: AppAction): boolean {
    return captureAppActionAdmission(action).admitsNow();
}
