import { type AppAction, type AutomationRecordingPolicy } from '#/utils/handlerContract';

const PROCESSING_ONLY_POLICY: AutomationRecordingPolicy = 'suppressed';

/**
 * A planner edit writes one static value; it is not the hand on a fader. Without this the writer
 * would read the edit as a gesture sample and start, extend, or flush an automation recording pass.
 */
function stampAction(action: AppAction): AppAction {
    if (action.type !== 'setDeviceParameter' && action.type !== 'setTrackGain' && action.type !== 'setTrackPan') {
        return action;
    }
    if (action.payload.automationRecordingPolicy === PROCESSING_ONLY_POLICY) {
        return action;
    }
    if (action.type === 'setDeviceParameter') {
        return {
            type: 'setDeviceParameter',
            payload: { ...action.payload, automationRecordingPolicy: PROCESSING_ONLY_POLICY },
        };
    }
    if (action.type === 'setTrackGain') {
        return {
            type: 'setTrackGain',
            payload: { ...action.payload, automationRecordingPolicy: PROCESSING_ONLY_POLICY },
        };
    }
    return {
        type: 'setTrackPan',
        payload: { ...action.payload, automationRecordingPolicy: PROCESSING_ONLY_POLICY },
    };
}

export function stampProcessingOnlyParameterPolicy(actions: readonly AppAction[]): AppAction[] {
    return actions.map(stampAction);
}
