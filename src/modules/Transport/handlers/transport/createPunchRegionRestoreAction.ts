import { getTransportState } from '../../useCases/transportQueries/getTransportState';

export function createPunchRegionRestoreAction() {
    const state = getTransportState();
    if (!state) {
        return null;
    }

    return {
        type: 'restorePunchRegion' as const,
        payload: {
            punchInBeat: state.punchInBeat,
            punchOutBeat: state.punchOutBeat,
        },
    };
}
