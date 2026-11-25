import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type SetCountInEnabledInput = {
    enabled: boolean;
    expectedEnabled?: boolean;
};

type SetCountInEnabledResult = {
    status: 'written' | 'no-write' | 'conflict';
};

export function setCountInEnabled(input: SetCountInEnabledInput): SetCountInEnabledResult {
    const state = getTransportState();
    if (!state || state.countInEnabled === input.enabled) {
        return { status: 'no-write' };
    }
    if (input.expectedEnabled !== undefined && state.countInEnabled !== input.expectedEnabled) {
        return { status: 'conflict' };
    }
    updateTransportState({ countInEnabled: input.enabled });
    return { status: 'written' };
}
