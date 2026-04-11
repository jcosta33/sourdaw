import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';

export function setPreRollBars(bars: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ preRollBars: Math.max(1, Math.min(8, bars)) });
}
