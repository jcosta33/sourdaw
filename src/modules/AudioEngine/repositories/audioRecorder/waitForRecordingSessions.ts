import { activeSessions, recordingLifecycleState } from './recordingSession';

export function waitForRecordingSessions(trackIds: ReadonlySet<string>): Promise<void> {
    if ([...trackIds].every((trackId) => !activeSessions.has(trackId))) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        recordingLifecycleState.stopWaiters.add({ resolve, trackIds: new Set(trackIds) });
    });
}
