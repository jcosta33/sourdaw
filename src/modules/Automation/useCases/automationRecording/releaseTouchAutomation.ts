import {
    touchActive,
    makeKey,
    flushPendingPoints,
} from '#/modules/Automation/stores/automationRecordingState';

export function releaseTouchAutomation(trackId: string, parameterId: string): void {
    const key = makeKey(trackId, parameterId);
    touchActive.delete(key);
    flushPendingPoints(key);
}
