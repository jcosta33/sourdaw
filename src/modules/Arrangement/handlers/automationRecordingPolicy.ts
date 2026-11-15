import { type HandlerSessionActionEntry } from '#/utils/handlerContract';

import { getActionAutomationRecordingPolicy } from './automationRecordingPolicyByActionType';

export { getActionAutomationRecordingPolicy };

/**
 * A persisted entry is replayable only when its inverse and redo agree with the
 * forward action about the policy. A stored pair that disagrees would restore
 * or reapply the edit as a gesture the original write refused to be, opening a
 * recording pass on a lane the user never touched — so the whole entry is
 * dropped rather than replayed half-suppressed.
 */
export function sessionEntryAgreesOnAutomationRecordingPolicy(entry: HandlerSessionActionEntry): boolean {
    const forward = getActionAutomationRecordingPolicy(entry.action);
    return (
        (entry.inverseAction === null || getActionAutomationRecordingPolicy(entry.inverseAction) === forward) &&
        (entry.redoAction === undefined || getActionAutomationRecordingPolicy(entry.redoAction) === forward)
    );
}
