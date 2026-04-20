import { type TransportState } from '../../models/TransportState';
import { getTransportState as repoGetTransportState } from '../../repositories/transport/getTransportState';

export function getTransportState(): TransportState | null {
    return repoGetTransportState();
}
