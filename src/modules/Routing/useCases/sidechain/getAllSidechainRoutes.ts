import { type SidechainRoute } from '../../models/SidechainRoute';
import { sidechainStore } from '../../stores/sidechainStore';

export function getAllSidechainRoutes(): SidechainRoute[] {
    return sidechainStore.value?.routes ?? [];
}