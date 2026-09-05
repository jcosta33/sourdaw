/**
 * Splice every instance a batch reported the engine took (#3575).
 *
 * Fire-and-forget, because the caller is a reporter on someone else's applied
 * batch: a splice that declines has already told the musician, and one that
 * throws must not unwind the batch that reported the attach.
 */

import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphApplyResult } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSessionSplice } from './nativeLiveGraphSessionSplice';

export function spliceInstancesAttachedBy(result: AudioGraphApplyResult): void {
    if (result.application !== 'applied') {
        return;
    }
    for (const attached of result.attachedPlugins ?? []) {
        void nativeLiveGraphSessionSplice({ instanceId: attached.instanceId }).catch((error: unknown) => {
            logger.warn(`[AudioEngine] splicing attached instance ${attached.instanceId} failed: ${String(error)}`);
        });
    }
}
