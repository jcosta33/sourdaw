import { type Track } from '../../models/Track';

export function stabilizeInterruptedFreeze(track: Track, adjustmentLayerMutationId?: string): Track {
    if (track.freezeState.status !== 'freezing') {
        return track;
    }
    if (track.frozen && track.frozenBufferId && track.freezeState.frozenBufferId) {
        const freezeState = { ...track.freezeState, status: 'stale' as const };
        delete freezeState.renderProgress;
        if (adjustmentLayerMutationId) {
            freezeState.adjustmentLayerMutationId = adjustmentLayerMutationId;
        }
        return { ...track, freezeState };
    }

    const unfrozen = { ...track, frozen: false, freezeState: { status: 'unfrozen' as const } };
    delete unfrozen.frozenBufferId;
    return unfrozen;
}
