import { updateTransportState } from '../../repositories/transport/updateTransportState';

type RestorePunchRegionInput = {
    punchInBeat: number;
    punchOutBeat: number;
};

export function restorePunchRegion(input: RestorePunchRegionInput): void {
    if (
        !Number.isFinite(input.punchInBeat) ||
        input.punchInBeat < 0 ||
        !Number.isFinite(input.punchOutBeat) ||
        input.punchOutBeat < 0 ||
        input.punchOutBeat <= input.punchInBeat
    ) {
        return;
    }

    updateTransportState({
        punchInBeat: input.punchInBeat,
        punchOutBeat: input.punchOutBeat,
    });
}
