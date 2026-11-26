/**
 * Ensure the `plugins-attached` subscription is live (#7368).
 *
 * A plugin loaded before the engine ran is attached by the first graph batch,
 * unless something held the instance at that moment (an editor close, a call
 * still inside it). The native host then attaches it once the hold is
 * released, with no batch to report it, and says so in this event. It gets
 * the same correction a batch's report gets: the attach state is written, so
 * the next play's topology binds the device, and a rolling session splices it
 * into its chain now.
 *
 * Idempotent: the first topology batch subscribes and every later one reuses
 * it. If subscribing fails the slot is released so a later batch retries. A
 * session calls this before it sends each topology batch, because that batch's
 * refused attach can be resolved natively before the batch even answers.
 */

import { logger } from '#/infra/logger/appLogger';

import { onNativePluginsAttached } from '../../repositories/nativeGraph/onNativePluginsAttached';

import { markEngineAttachedInstances } from './markEngineAttachedInstances';
import { spliceAttachedInstances } from './spliceAttachedInstances';

let subscription: Promise<() => void> | null = null;

export function watchNativePluginAttachments(): void {
    if (subscription) {
        return;
    }
    subscription = onNativePluginsAttached((attached) => {
        markEngineAttachedInstances(attached);
        spliceAttachedInstances(attached);
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`[AudioEngine] failed to subscribe to native plugin attachments: ${String(error)}`);
        return () => {};
    });
}
