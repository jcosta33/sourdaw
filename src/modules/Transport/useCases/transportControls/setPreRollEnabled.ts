import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type SetPreRollEnabledInput = {
    enabled: boolean;
    expectedEnabled?: boolean;
};

type SetPreRollEnabledResult = {
    status: 'written' | 'no-write' | 'conflict';
};

export function setPreRollEnabled(input: SetPreRollEnabledInput): SetPreRollEnabledResult {
    const state = getTransportState();
    if (!state || state.preRollEnabled === input.enabled) {
        return { status: 'no-write' };
    }
    if (input.expectedEnabled !== undefined && state.preRollEnabled !== input.expectedEnabled) {
        return { status: 'conflict' };
    }
    updateTransportState({ preRollEnabled: input.enabled });
    return { status: 'written' };
}
