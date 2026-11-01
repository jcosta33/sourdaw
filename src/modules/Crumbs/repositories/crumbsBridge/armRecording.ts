import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import type { AcceptedCrumbsTake } from '../../stores/crumbsRecordingStore';

/** Acceptance identifies the request; only native lifecycle events prove input. */
export async function armRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<AcceptedCrumbsTake | null> {
    if (!isDesktopRuntime()) {
        return null;
    }
    const result = await desktopInvoke('arm_recording', { instanceId, threshold, targetPad, maxDurationSecs });
    if (
        typeof result !== 'object' ||
        result === null ||
        !('take_id' in result) ||
        typeof result.take_id !== 'string' ||
        !/^[1-9][0-9]*$/u.test(result.take_id) ||
        BigInt(result.take_id) > 18446744073709551615n
    ) {
        throw new TypeError('Invalid Crumbs accepted take id');
    }
    return { take_id: result.take_id };
}
