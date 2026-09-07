import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import {
    isRetireNativeEngineOutcome,
    type RetireNativeEngineOutcome,
    type RetireNativeEngineResult,
} from '../../models/RetireNativeEngineOutcome';

function readOutcome(payload: Record<string, unknown>): RetireNativeEngineOutcome {
    const outcome = payload.outcome;

    if (!isRetireNativeEngineOutcome(outcome)) {
        // Unlike a diagnostics counter there is no honest fallback: the caller
        // decides whether to re-arm the engine from this token alone, and
        // guessing either way is a wrong decision made silently.
        throw new Error(`[AudioEngine] unrecognized retire_native_engine outcome: ${String(outcome)}`);
    }

    return outcome;
}

function readRetiredInstanceIds(payload: Record<string, unknown>): readonly string[] {
    const retiredInstanceIds = payload.retiredInstanceIds;

    if (Array.isArray(retiredInstanceIds)) {
        const ids: string[] = [];
        for (const id of retiredInstanceIds as readonly unknown[]) {
            if (typeof id !== 'string') {
                break;
            }
            ids.push(id);
        }
        if (ids.length === retiredInstanceIds.length) {
            return ids;
        }
    }

    // Same reasoning as the outcome: a caller reloading plugins from a
    // guessed list would reload the wrong ones, or none at all, silently.
    throw new Error(
        `[AudioEngine] unrecognized retire_native_engine retiredInstanceIds: ${JSON.stringify(retiredInstanceIds)}`
    );
}

function readResult(response: unknown): RetireNativeEngineResult {
    const payload = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};

    return {
        outcome: readOutcome(payload),
        retiredInstanceIds: readRetiredInstanceIds(payload),
    };
}

/**
 * Empty the native engine slot so the next graph batch boots a fresh engine on
 * the current default device.
 *
 * The command never refuses: a slot that is empty, and an engine that is still
 * rendering, are outcomes rather than errors. The browser build has no native
 * engine, so it reports `no-engine` without reaching a bridge that is not
 * there.
 *
 * A retired engine cannot recreate the dormant records of the plugins it
 * owned, so `retiredInstanceIds` names exactly which instances the caller
 * must reload itself.
 */
export async function retireNativeEngine(): Promise<RetireNativeEngineResult> {
    if (!isDesktopRuntime()) {
        return { outcome: 'no-engine', retiredInstanceIds: [] };
    }

    return readResult(await desktopInvoke('retire_native_engine'));
}
