import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

export type ArmRetrospectiveCaptureResult =
    Readonly<{ outcome: 'applied' }> | Readonly<{ outcome: 'declined'; reason: string }>;

/**
 * Arm the native engine's retrospective audio ring for one project track.
 *
 * Declines rather than throws: there is no engine in a browser build, and on
 * the desktop the native side refuses an unsupported channel count. Both are
 * outcomes the caller carries on from. With no engine running, or a strip the
 * engine does not know yet, the native side records the arm and applies it
 * on the next graph batch.
 */
export async function armRetrospectiveCapture(
    trackId: string,
    channels: number
): Promise<ArmRetrospectiveCaptureResult> {
    if (!isDesktopRuntime()) {
        return { outcome: 'declined', reason: 'no desktop runtime' };
    }

    try {
        await desktopInvoke('arm_retrospective_capture', { trackId, channels });
        return { outcome: 'applied' };
    } catch (error) {
        return { outcome: 'declined', reason: error instanceof Error ? error.message : String(error) };
    }
}
