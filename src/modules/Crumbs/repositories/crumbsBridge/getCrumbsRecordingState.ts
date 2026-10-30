import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { decodeCrumbsRecordingSnapshot, type CrumbsRecordingSnapshot } from '../../stores/crumbsRecordingStore';

export async function getCrumbsRecordingState(instanceId: string): Promise<CrumbsRecordingSnapshot | null> {
    if (!isDesktopRuntime()) {
        return null;
    }
    return decodeCrumbsRecordingSnapshot(await desktopInvoke('get_crumbs_recording_state', { instanceId }));
}
