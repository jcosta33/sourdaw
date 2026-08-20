import { logger } from '#/infra/logger/appLogger';
import { desktopSamplesBaseUrl } from '#/utils/desktopBridge';
import { isSourdawRuntime } from '#/utils/desktopRuntime';

/**
 * Resolve the base URL the sample manifest and its sample files load from.
 *
 * On the web this is the public `/samples/levain/<instrumentId>` path. In the
 * desktop shell the main process serves the bundled sample library at one base
 * URL, so the engine reads the massive sample banks straight from OS resources
 * rather than the embedded frontend cache; the per-instrument layout below the
 * base matches the web tree. If the desktop resolution fails the web base path
 * is returned as a fallback.
 */
export async function resolveSampleBasePath(instrumentId: string): Promise<string> {
    const webBase = `/samples/levain/${instrumentId}`;
    if (!isSourdawRuntime()) {
        return webBase;
    }
    try {
        return `${await desktopSamplesBaseUrl()}/levain/${instrumentId}`;
    } catch (error) {
        logger.warn('[Levain] Failed to resolve Sourdaw samples base URL:', error);
        return webBase;
    }
}
