import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export type DisarmRetrospectiveCaptureResult =
    Readonly<{ outcome: 'applied' }> | Readonly<{ outcome: 'declined'; reason: string }>;

/**
 * Stop the native engine's retrospective audio retention.
 *
 * Declines rather than throws when no desktop runtime or engine is present.
 */
export async function disarmRetrospectiveCapture(): Promise<DisarmRetrospectiveCaptureResult> {
    if (!isDesktopRuntime()) {
        return { outcome: 'declined', reason: 'no desktop runtime' };
    }

    try {
        await desktopInvoke('disarm_retrospective_capture');
        return { outcome: 'applied' };
    } catch (error) {
        return { outcome: 'declined', reason: error instanceof Error ? error.message : String(error) };
    }
}
