import { type Step } from '../models/ToasterKit';

import { getSequencerPlaybackState } from './getSequencerPlaybackState';

type ShouldTriggerSequencerStepInput = {
    deviceId: string;
    step: Step;
    loopIndex: number;
};

export function shouldTriggerSequencerStep({ deviceId, step, loopIndex }: ShouldTriggerSequencerStepInput): boolean {
    if (!step.active) {
        return false;
    }

    const seqState = getSequencerPlaybackState(deviceId);

    switch (step.condition) {
        case 'always':
            break;
        case 'fill':
            if (!seqState.fillActive) {
                return false;
            }
            break;
        case 'not-fill':
            if (seqState.fillActive) {
                return false;
            }
            break;
        case 'first':
            if (loopIndex > 0) {
                return false;
            }
            break;
        case 'not-first':
            if (loopIndex === 0) {
                return false;
            }
            break;
        default:
            break;
    }

    if (step.probability < 1 && Math.random() > step.probability) {
        return false;
    }

    return true;
}
