import { isTauri } from '#/utils/tauriBridge';

import { invokeCrumbs } from './invokeCrumbs';

export async function stopRecording(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeCrumbs('stop_recording', { instanceId });
}
