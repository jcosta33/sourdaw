import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

export async function armRecording(
    instanceId: string,
    threshold: number,
    targetPad: number,
    maxDurationSecs: number
): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('arm_recording', { instanceId, threshold, targetPad, maxDurationSecs });
}
