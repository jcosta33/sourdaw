import { type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

export function getSidechainRoutesForTrack(trackId: string): SidechainRoute[] {
    const state = sidechainStore.value;
    if (!state) {
        return [];
    }
    return state.routes.filter((r) => r.sourceTrackId === trackId || r.targetTrackId === trackId);
}