import { updateTransportState as repoUpdateTransportState } from '../../repositories/transport/updateTransportState';
import { type TransportState } from '../../models/TransportState';

export function updateTransportState(patch: Partial<TransportState>): void {
    repoUpdateTransportState(patch);
}