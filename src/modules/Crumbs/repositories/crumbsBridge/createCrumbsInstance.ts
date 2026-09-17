import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import type { CrumbsCreateResult } from '../../models/CrumbsTypes';

/**
 * Create the native Crumbs runtime for one device, and report whether it took
 * an engine slot.
 *
 * A browser build has no native side at all, so it reports the same thing a
 * dormant create does: no engine holds this instance, and none will until one
 * exists to attach it.
 */
export async function createCrumbsInstance(instanceId: string): Promise<CrumbsCreateResult> {
    if (!isDesktopRuntime()) {
        return { attached: false };
    }
    const result = await desktopInvoke('create_crumbs', { instanceId });
    // Read rather than cast: a shell whose addon predates the field answers
    // without it, and "attached" is what decides whether a strip may claim a
    // native body — a missing field must read as "not attached", never as one.
    const attached = typeof result === 'object' && result !== null && 'attached' in result ? result.attached : null;
    return { attached: attached === true };
}
