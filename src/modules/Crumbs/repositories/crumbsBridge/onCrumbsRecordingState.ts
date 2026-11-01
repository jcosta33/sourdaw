import { desktopListen, isDesktopRuntime } from '#/utils/desktopBridge';

import { decodeCrumbsRecordingSnapshot, type CrumbsRecordingSnapshot } from '../../stores/crumbsRecordingStore';

export async function onCrumbsRecordingState(
    handler: (snapshot: CrumbsRecordingSnapshot) => void
): Promise<() => void> {
    if (!isDesktopRuntime()) {
        return () => undefined;
    }
    return desktopListen('crumbs-recording-state', (event: unknown) => {
        if (typeof event !== 'object' || event === null || !('payload' in event)) {
            return;
        }
        let snapshot: CrumbsRecordingSnapshot;
        try {
            snapshot = decodeCrumbsRecordingSnapshot(event.payload);
        } catch {
            return;
        }
        handler(snapshot);
    });
}
