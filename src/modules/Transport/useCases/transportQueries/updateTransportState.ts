import { type TransportState } from '../../models/TransportState';
import { updateTransportState as repoUpdateTransportState } from '../../repositories/transport/updateTransportState';

export function updateTransportState(patch: Partial<TransportState>): void {
    repoUpdateTransportState(patch);
}
