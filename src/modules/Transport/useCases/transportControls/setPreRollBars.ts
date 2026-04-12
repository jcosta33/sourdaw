import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

export function setPreRollBars(bars: number): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ preRollBars: Math.max(1, Math.min(8, bars)) });
}
