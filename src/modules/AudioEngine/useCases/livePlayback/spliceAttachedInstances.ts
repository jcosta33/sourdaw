/**
 * Splice every instance the engine was reported to have taken (#3575).
 *
 * Fire-and-forget, because the caller is a reporter on someone else's answer
 * — an applied batch, or the native host's own re-attach event: a splice that
 * declines has already told the musician, and one that throws must not unwind
 * whatever reported the attach.
 */

import { logger } from '#/infra/logger/appLogger';

import { type AudioGraphAttachedPlugin } from '../../models/AudioGraphBackend';

import { nativeLiveGraphSessionSplice } from './nativeLiveGraphSessionSplice';

export function spliceAttachedInstances(attached: readonly AudioGraphAttachedPlugin[]): void {
    for (const plugin of attached) {
        void nativeLiveGraphSessionSplice({ instanceId: plugin.instanceId }).catch((error: unknown) => {
            logger.warn(`[AudioEngine] splicing attached instance ${plugin.instanceId} failed: ${String(error)}`);
        });
    }
}
