import { describeAppActionRefusal, executeAppAction, isAppActionAdmissionRefusal } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { captureElasticDetectionOwner } from './captureElasticDetectionOwner';
import { elasticRootIdentityProviderState } from './elasticRootIdentityProviderState';
import { markElasticDetectionComplete } from './markElasticDetectionComplete';
import { transientDetectionRevision } from './transientDetectionRevision';

/**
 * A committed detection may finish after this editor has moved to another source.
 * A project that refuses the mutation resolves `false` after telling the user why. The
 * detector's own conflicts (cancelled, stale source, analysis failure) are not refusals
 * and reject, so the caller still reports them as a failed detection.
 */
export async function detectElasticEditorTransients(clipId: string, sensitivity: number): Promise<boolean> {
    const owner = captureElasticDetectionOwner(elasticRootIdentityProviderState, undefined, clipId);
    if (!owner) {
        return false;
    }
    try {
        await executeAppAction(
            { type: 'detectTransients', payload: { clipId, sensitivity } },
            { signal: owner.signal }
        );
        if (
            owner.isInvalidated() ||
            owner.signal.aborted ||
            !owner.matches() ||
            transientDetectionRevision(clipId) !== owner.revision + 1
        ) {
            return false;
        }
        markElasticDetectionComplete();
        return true;
    } catch (error) {
        if (!isAppActionAdmissionRefusal(error)) {
            throw error;
        }
        notifyUser(describeAppActionRefusal('detectTransients'), 'warning');
        return false;
    } finally {
        owner.dispose();
    }
}
