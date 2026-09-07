import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { isRetireNativeEngineOutcome, type RetireNativeEngineOutcome } from '../../models/RetireNativeEngineOutcome';

function readOutcome(response: unknown): RetireNativeEngineOutcome {
    const outcome =
        typeof response === 'object' && response !== null ? (response as Record<string, unknown>).outcome : undefined;

    if (!isRetireNativeEngineOutcome(outcome)) {
        // Unlike a diagnostics counter there is no honest fallback: the caller
        // decides whether to re-arm the engine from this token alone, and
        // guessing either way is a wrong decision made silently.
        throw new Error(`[AudioEngine] unrecognized retire_native_engine outcome: ${String(outcome)}`);
    }

    return outcome;
}

/**
 * Empty the native engine slot so the next graph batch boots a fresh engine on
 * the current default device.
 *
 * The command never refuses: a slot that is empty, and an engine that is still
 * rendering, are outcomes rather than errors. The browser build has no native
 * engine, so it reports `no-engine` without reaching a bridge that is not
 * there.
 */
export async function retireNativeEngine(): Promise<RetireNativeEngineOutcome> {
    if (!isDesktopRuntime()) {
        return 'no-engine';
    }

    return readOutcome(await desktopInvoke('retire_native_engine'));
}
