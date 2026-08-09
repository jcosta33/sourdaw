import { getTransportState } from '../../repositories/transport/getTransportState';

import { setPunchEnabled } from './setPunchEnabled';

export function togglePunchEnabled(): ReturnType<typeof setPunchEnabled> {
    const state = getTransportState();
    if (!state) {
        return { status: 'no-write' };
    }
    return setPunchEnabled({ enabled: !state.punchInEnabled, expectedEnabled: state.punchInEnabled });
}
