/**
 * Centralised runtime-capability detection.
 *
 * Per the systemic-issues audit (§10.2 item 7, §8.2 / §8.3 / §8.4 / N15), every
 * branch that asked "are we on desktop?" / "do we have SharedArrayBuffer?" /
 * "does this model support the tools API?" lived at its own call site. That
 * scattered ownership caused three distinct production regressions, so the
 * canonical checks now live here and every runtime guard must route through
 * this module.
 *
 * All probes are cheap and synchronous; keep them uncached so a probe always
 * answers for the current page state.
 */

import { logger } from '#/infra/logger/appLogger';

import { isDesktopRuntime } from './desktopRuntime';

export { isDesktopRuntime };

/** `true` when `SharedArrayBuffer` is available at runtime. */
export function hasSharedArrayBuffer(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
}

/**
 * `true` when the page is cross-origin isolated (COOP/COEP applied).
 * Required for SharedArrayBuffer-backed WASM DSP (Grand Boule, Gluten, Proof).
 */
export function isCrossOriginIsolated(): boolean {
    return (
        typeof globalThis !== 'undefined' &&
        Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated)
    );
}

/**
 * Bundle of runtime capabilities. Kept as a plain value so tests can diff it
 * and the boot banner can render it without calling the probes individually.
 */
export type RuntimeCapabilities = {
    isDesktopRuntime: boolean;
    hasSharedArrayBuffer: boolean;
    isCrossOriginIsolated: boolean;
};

export function getRuntimeCapabilities(): RuntimeCapabilities {
    return {
        isDesktopRuntime: isDesktopRuntime(),
        hasSharedArrayBuffer: hasSharedArrayBuffer(),
        isCrossOriginIsolated: isCrossOriginIsolated(),
    };
}

/**
 * Boot-time probe. Logs a single structured line at info level so the banner
 * is obvious in both web and desktop dev consoles. Warns when
 * `crossOriginIsolated` is false because that silently disables every
 * SAB-backed DSP plugin — historically a top source of "plugin loaded but
 * produces no sound" reports.
 */
export function logCapabilities(): void {
    const capabilities = getRuntimeCapabilities();
    logger.info(`[capabilities] ${JSON.stringify(capabilities)}`);
    if (!capabilities.isCrossOriginIsolated) {
        logger.warn(
            '[capabilities] crossOriginIsolated=false — SharedArrayBuffer-backed plugins (Grand Boule, Gluten, Proof) will fail to instantiate. Check COOP/COEP headers.'
        );
    }
}
