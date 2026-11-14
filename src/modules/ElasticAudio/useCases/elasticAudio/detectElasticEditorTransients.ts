import { executeUserAppAction } from '#/modules/Command/useCases';

import { captureElasticDetectionOwner } from './captureElasticDetectionOwner';
import { elasticRootIdentityProviderState } from './elasticRootIdentityProviderState';
import { markElasticDetectionComplete } from './markElasticDetectionComplete';
import { transientDetectionRevision } from './transientDetectionRevision';

/**
 * A committed detection may finish after this editor has moved to another source.
 * A refused project resolves `false`: the revision never advanced, so the guard below
 * rejects it and the person already got the reason as a notification.
 */
export async function detectElasticEditorTransients(clipId: string, sensitivity: number): Promise<boolean> {
    const owner = captureElasticDetectionOwner(elasticRootIdentityProviderState, undefined, clipId);
    if (!owner) {
        return false;
    }
    try {
        await executeUserAppAction(
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
    } finally {
        owner.dispose();
    }
}
