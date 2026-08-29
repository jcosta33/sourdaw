import { SectionRenderFollowUpError } from '../models/SectionRenderFollowUpError';

export function getSectionRenderFollowUpFailure(error: unknown) {
    if (!(error instanceof SectionRenderFollowUpError)) {
        return null;
    }
    return {
        failureKind: error.failureKind,
        remediation: error.pendingEffect.remediation,
    };
}
