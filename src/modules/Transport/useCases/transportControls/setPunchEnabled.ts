import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type SetPunchEnabledInput = {
    enabled: boolean;
    expectedEnabled?: boolean;
};

type SetPunchEnabledResult = {
    status: 'written' | 'no-write' | 'conflict';
};

export function setPunchEnabled(input: SetPunchEnabledInput): SetPunchEnabledResult {
    const state = getTransportState();
    if (!state) {
        return { status: 'no-write' };
    }
    if (state.punchInEnabled === input.enabled) {
        return { status: 'no-write' };
    }
    if (input.expectedEnabled !== undefined && state.punchInEnabled !== input.expectedEnabled) {
        return { status: 'conflict' };
    }
    if (state.isPlaying || state.isRecording) {
        return { status: 'conflict' };
    }

    updateTransportState({ punchInEnabled: input.enabled });
    return { status: 'written' };
}
