import { markCrumbsInstanceAttached } from '../../stores/crumbsEngineAttachmentStore';

type MarkCrumbsEngineAttachedInput = {
    /** The Crumbs instance id, which is the device's own id. */
    instanceId: string;
};

/**
 * Record that the engine has taken over one Crumbs instance.
 *
 * `create_crumbs` answers `attached: false` for an instance made before any
 * engine was rendering — the sampler is dormant, its writes park — and nothing
 * else ever revises that answer: the attach happens inside a graph batch and
 * the batch's own result is the only report of it. So this is the correction a
 * caller applies from that report.
 *
 * The mirror it writes is what the carrier law reads, so both directions of
 * error are audible. A missed call leaves a sampler the engine is rendering on
 * Web Audio for the rest of the session; a call for an instance the engine did
 * not take builds a topology naming an instance it does not hold, which the
 * mapper refuses whole.
 *
 * Idempotent: an instance already recorded leaves the mirror untouched.
 */
export function markCrumbsEngineAttached({ instanceId }: MarkCrumbsEngineAttachedInput): void {
    markCrumbsInstanceAttached(instanceId);
}
