/**
 * Write the Crumbs attachments a batch reported into the Crumbs mirror.
 *
 * Its own file beside {@link markAttachedInstances}, and for the same reason
 * that one is separate: the reporter that calls both also triggers the splice,
 * and importing it back here would close a cycle `no-circular` refuses.
 *
 * Only an applied batch reports an attach. A `needs-reconcile` batch changed
 * part of the graph and could not say what it left behind, so nothing about it
 * is evidence that the engine took an instance over.
 */

import { markCrumbsInstanceAttached } from '#/modules/Crumbs/stores';

import { type AudioGraphApplyResult } from '../../models/AudioGraphBackend';

export function markAttachedCrumbsInstances(result: AudioGraphApplyResult): void {
    if (result.application !== 'applied') {
        return;
    }
    for (const attached of result.attachedCrumbs ?? []) {
        markCrumbsInstanceAttached(attached.instanceId);
    }
}
