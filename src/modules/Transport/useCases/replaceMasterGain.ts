import { getTransportState } from '../repositories/transport/getTransportState';
import { updateTransportState } from '../repositories/transport/updateTransportState';

type ReplaceMasterGainInput = {
    expectedPercent: number;
    replacementPercent: number;
};

function isPercentInterval(value: number): boolean {
    return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function replaceMasterGain({ expectedPercent, replacementPercent }: ReplaceMasterGainInput): boolean {
    if (!isPercentInterval(expectedPercent) || !isPercentInterval(replacementPercent)) {
        return false;
    }
    const state = getTransportState();
    if (!state || state.masterGain !== expectedPercent || state.masterGain === replacementPercent) {
        return false;
    }
    updateTransportState({ masterGain: replacementPercent });
    return true;
}
