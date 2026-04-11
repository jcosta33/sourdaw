import { type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

export function getSidechainSource(targetDeviceId: string): SidechainRoute | null {
    const state = sidechainStore.value;
    if (!state) {
        return null;
    }
    return state.routes.find((r) => r.targetDeviceId === targetDeviceId) ?? null;
}