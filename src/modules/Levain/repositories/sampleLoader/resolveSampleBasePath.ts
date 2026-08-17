import { resolveResource } from '@tauri-apps/api/path';

import { logger } from '#/infra/logger/appLogger';
import { desktopSamplesBaseUrl } from '#/utils/tauriBridge';
import { isSourdawRuntime } from '#/utils/tauriRuntime';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Resolve the base URL the sample manifest and its sample files load from.
 *
 * On the web this is the public `/samples/levain/<instrumentId>` path. In Tauri
 * desktop we instead resolve the bundled resource directory (parent-relative
 * assets live under `_up_` to protect the root Resources directory) and convert
 * it to a webview-loadable URL via `convertFileSrc`, so the engine reads the
 * massive sample banks straight from OS resources rather than the embedded
 * frontend cache.
 *
 * Per "Repositories Touch Metal", all Tauri IPC lives here; the
 * `autoLoadLevainSamples` use case merely orchestrates this resolution. If the
 * Tauri resolution fails the web base path is returned as a fallback.
 */
export async function resolveSampleBasePath(instrumentId: string): Promise<string> {
    const webBase = `/samples/levain/${instrumentId}`;
    if (isSourdawRuntime()) {
        try {
            // The Electron main process serves the bundled samples at one base
            // URL; the per-instrument layout below it matches the web tree.
            return `${await desktopSamplesBaseUrl()}/levain/${instrumentId}`;
        } catch (error) {
            logger.warn('[Levain] Failed to resolve Sourdaw samples base URL:', error);
            return webBase;
        }
    }
    if (!isTauri) {
        return webBase;
    }
    try {
        const localPath = await resolveResource(`_up_/public/samples/levain/${instrumentId}`);
        const tauriCore = await import('@tauri-apps/api/core');
        // eslint-disable-next-line sourdaw/no-type-assertion-escape -- dynamic import type doesn't expose convertFileSrc; runtime value is structurally correct
        const { convertFileSrc } = tauriCore as unknown as { convertFileSrc: (p: string) => string };
        return convertFileSrc(localPath);
    } catch (error) {
        logger.warn('[Levain] Failed to resolve Tauri resource path:', error);
        return webBase;
    }
}
