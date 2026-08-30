import { getTransportState } from '../../repositories/transport/getTransportState';
import { updateTransportState } from '../../repositories/transport/updateTransportState';

type RestoreLoopRegionInput = {
    loopStart: number;
    loopEnd: number;
    isLooping: boolean;
};

export function restoreLoopRegion({ loopStart, loopEnd, isLooping }: RestoreLoopRegionInput): void {
    const state = getTransportState();
    if (!state) {
        return;
    }
    updateTransportState({ loopStart, loopEnd, isLooping });
}
