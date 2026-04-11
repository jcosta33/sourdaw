import { getTransportState as repoGetTransportState } from '../../repositories/transport/getTransportState';
import { type TransportState } from '../../models/TransportState';

export function getTransportState(): TransportState | null {
    return repoGetTransportState();
}